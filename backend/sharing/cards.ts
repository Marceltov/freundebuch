// Own cards (ADR 0024): what a person says about themselves, the only thing that crosses from one person to another (V3).
// A user keeps cards of their own, each named ("Privat", "Arbeit"), and may publish each behind a secret link of its own, as a
// vCard any contacts app can read too; another freundebuch subscribes to that link for the person, the way a calendar subscribes
// to a feed, and fetches it again once a day.
// No federation: nothing else is ever fetched or sent, and a card holds only what its owner wrote on it.
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { get } from "node:https";
import type { LookupFunction } from "node:net";
import { BlockList, isIP } from "node:net";
import { config } from "../core/config";
import { db, newId, now } from "../db";
import { InvalidInputError, NotFoundError } from "../core/errors";
import { errorFields, logger } from "../core/log";
import type { Viewer } from "../core/types";
import { viewerById } from "../core/users";

const log = logger("cards");

export const CARD_FIELDS = ["name", "phone", "email", "address", "birthday", "note"] as const;
export type CardField = (typeof CARD_FIELDS)[number];
/** What a card says. `birthday` is YYYY-MM-DD, or --MM-DD without the year. Every field may be left out. */
export type Card = Partial<Record<CardField, string>>;

const MAX = { name: 200, phone: 50, email: 200, address: 500, birthday: 10, note: 1000 } as const;
const BIRTHDAY = /^(\d{4}|--)-?(\d{2})-?(\d{2})$/;

/** The card, trimmed, with empty fields dropped; InvalidInputError for a field too long or a birthday that isn't a day. */
export function checkCard(input: unknown): Card {
  if (!input || typeof input !== "object") throw new InvalidInputError("card must be an object");
  const out: Card = {};
  for (const f of CARD_FIELDS) {
    const raw = (input as Record<string, unknown>)[f];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") throw new InvalidInputError(`card.${f} must be text`);
    const v = raw.trim();
    if (!v) continue;
    if (v.length > MAX[f]) throw new InvalidInputError(`card.${f} is longer than ${MAX[f]} characters`);
    out[f] = f === "birthday" ? birthdayOf(v) : v;
  }
  return out;
}

function birthdayOf(v: string): string {
  const m = BIRTHDAY.exec(v);
  if (!m) throw new InvalidInputError("card.birthday must be YYYY-MM-DD, or --MM-DD without the year");
  const [, y, mm, dd] = m;
  const day = `${y === "--" ? "2000" : y}-${mm}-${dd}`;
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
    throw new InvalidInputError("card.birthday is not a day");
  return y === "--" ? `--${mm}-${dd}` : `${y}-${mm}-${dd}`;
}

// ---- vCard ------------------------------------------------------------------------------------------------------------------

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const unesc = (v: string) => v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** The card as a vCard 4.0, for freundebuch and every contacts app. */
export function toVCard(c: Card, updatedAt: number): string {
  const lines = ["BEGIN:VCARD", "VERSION:4.0", "PRODID:-//freundebuch//own card//EN", `FN:${esc(c.name ?? "")}`];
  if (c.phone) lines.push(`TEL;TYPE=cell:${esc(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${esc(c.email)}`);
  if (c.address) lines.push(`ADR:;;${esc(c.address)};;;;`);
  if (c.birthday) lines.push(`BDAY:${c.birthday.replace(/-/g, "").replace(/^(?=\d{4}$)/, "--")}`);
  if (c.note) lines.push(`NOTE:${esc(c.note)}`);
  lines.push(`REV:${new Date(updatedAt).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`, "END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** What a vCard (3.0 or 4.0) says, as far as a card holds it; null when the text is no vCard. Only the first card counts. */
export function parseVCard(text: string): Card | null {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  if (!lines.some((l) => /^BEGIN:VCARD$/i.test(l.trim()))) return null;
  const raw: Card = {};
  for (const line of lines) {
    if (/^END:VCARD$/i.test(line.trim())) break;
    const at = line.indexOf(":");
    if (at < 0) continue;
    const prop = line
      .slice(0, at)
      .split(";")[0]
      .replace(/^[^.]+\./, "")
      .toUpperCase();
    const value = line.slice(at + 1);
    const set = (f: CardField, v: string) => raw[f] === undefined && v.trim() && (raw[f] = v.trim());
    if (prop === "FN") set("name", unesc(value));
    else if (prop === "TEL") set("phone", unesc(value).replace(/^tel:/i, ""));
    else if (prop === "EMAIL") set("email", unesc(value));
    else if (prop === "ADR")
      set(
        "address",
        value
          .split(/(?<!\\);/)
          .map(unesc)
          .filter((p) => p.trim())
          .join(", "),
      );
    else if (prop === "BDAY") {
      const b = /^(\d{4}|--)-?(\d{2})-?(\d{2})/.exec(value.trim());
      if (b) set("birthday", b[1] === "--" ? `--${b[2]}-${b[3]}` : `${b[1]}-${b[2]}-${b[3]}`);
    } else if (prop === "NOTE") set("note", unesc(value));
  }
  try {
    return checkCard(raw);
  } catch {
    // A card from elsewhere that doesn't fit is kept as far as it does.
    return Object.fromEntries(CARD_FIELDS.flatMap((f) => (raw[f] && raw[f]!.length <= MAX[f] && f !== "birthday" ? [[f, raw[f]]] : []))) as Card;
  }
}

// ---- the user's own cards -------------------------------------------------------------------------------------------------

const KEY_PREFIX = "fbk_";
const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** Where the card of `key` is served, as a path. */
export const cardPath = (key: string) => `/api/card/${key}.vcf`;

/** One of the viewer's own cards: its name, what it says, and whether its link works now. */
export type OwnCard = { label: string; card: Card; published: boolean };

const MAX_LABEL = 50;

function checkLabel(label: string): string {
  const l = label.trim();
  if (!l) throw new InvalidInputError("A card needs a name");
  if (l.length > MAX_LABEL) throw new InvalidInputError(`A card's name is longer than ${MAX_LABEL} characters`);
  return l;
}

async function cardRows(v: Viewer) {
  return (await db()).selectFrom("own_cards").select(["id", "label", "card", "key_hash"]).where("user_id", "=", v.userId).orderBy("label").execute();
}

/** The viewer's card named `label`, matched without regard to case, or undefined. */
async function cardRow(v: Viewer, label: string) {
  const l = checkLabel(label).toLowerCase();
  return (await cardRows(v)).find((r) => r.label.toLowerCase() === l);
}

async function mustCard(v: Viewer, label: string) {
  const r = await cardRow(v, label);
  if (!r) throw new NotFoundError(`No card named ${label.trim()}`);
  return r;
}

/** The viewer's own cards, by name. */
export async function ownCards(v: Viewer): Promise<OwnCard[]> {
  return (await cardRows(v)).map((r) => ({ label: r.label, card: JSON.parse(r.card) as Card, published: !!r.key_hash }));
}

/** Writes the viewer's card named `label`, a new one when they have none of that name. Its link, if published, serves the new card from now on. */
export async function setOwnCard(v: Viewer, label: string, input: unknown): Promise<OwnCard> {
  const card = checkCard(input);
  const json = JSON.stringify(card);
  const d = await db();
  const r = await cardRow(v, label);
  if (r) await d.updateTable("own_cards").set({ card: json, updated_at: now() }).where("id", "=", r.id).execute();
  else
    await d
      .insertInto("own_cards")
      .values({ id: newId(), user_id: v.userId, label: checkLabel(label), card: json, key_hash: null, created_at: now(), updated_at: now() })
      .execute();
  return { label: r?.label ?? checkLabel(label), card, published: !!r?.key_hash };
}

/** Deletes the viewer's card named `label`, and with it its link. */
export async function deleteOwnCard(v: Viewer, label: string): Promise<void> {
  const r = await mustCard(v, label);
  await (await db()).deleteFrom("own_cards").where("id", "=", r.id).execute();
}

/** A new secret link to the viewer's card named `label`; that card's previous link stops working, the others' don't. Shown once: only its hash is kept. */
export async function publishCard(v: Viewer, label: string): Promise<string> {
  const r = await mustCard(v, label);
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  await (
    await db()
  )
    .updateTable("own_cards")
    .set({ key_hash: hashKey(key) })
    .where("id", "=", r.id)
    .execute();
  return key;
}

/** Ends the link to the card named `label`: whoever subscribed to it keeps the card as last fetched, and gets nothing new. */
export async function unpublishCard(v: Viewer, label: string): Promise<void> {
  const r = await mustCard(v, label);
  await (await db()).updateTable("own_cards").set({ key_hash: null }).where("id", "=", r.id).execute();
}

/** GET /api/card/<key>.vcf: the card the key publishes, or 404. */
export async function cardRoute(file: string): Promise<Response> {
  const key = file.endsWith(".vcf") ? file.slice(0, -4) : "";
  const r = key.startsWith(KEY_PREFIX)
    ? await (await db()).selectFrom("own_cards").select(["user_id", "card", "updated_at"]).where("key_hash", "=", hashKey(key)).executeTakeFirst()
    : undefined;
  if (!r || !(await viewerById(r.user_id))) return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(toVCard(JSON.parse(r.card) as Card, r.updated_at), {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": 'inline; filename="card.vcf"',
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}

// ---- the cards of the people in the book ----------------------------------------------------------------------------------

/** A subscribed card as the book shows it: what it said when last fetched, and why the last fetch failed, if it did. */
export type PersonCard = { card: Card | null; fetchedAt: number | null; failed: CardFailure | null };
export type CardFailure = "unreachable" | "not_found" | "not_a_card" | "refused";

// Addresses a card is never fetched from: this server and the networks behind it. A typed URL must not become a way to read
// the services next to freundebuch (its Whisper, the router).
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  blocked.addSubnet(net, bits, "ipv6");

export type Resolver = (host: string) => Promise<string[]>;
const resolve: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);
const isPublic = (a: string) => !blocked.check(a, isIP(a) === 6 ? "ipv6" : "ipv4");

/** Whether `url` may be fetched: https (http too in e2e), and a host that resolves only to public addresses. */
export async function fetchable(url: string, resolver: Resolver = resolve): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol !== "https:" && !(u.protocol === "http:" && config.e2e())) return false;
  if (config.e2e()) return true;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolver(host).catch(() => []);
  return addresses.length > 0 && addresses.every(isPublic);
}

const MAX_BYTES = 64 * 1024;

/** How a card is fetched: a GET that answers with a Response. Tests pass their own. */
export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

/**
 * A GET over https whose connection goes only to an address checked as it connects. `fetchable` checks the host's addresses
 * first, but a host that answers differently the second time (DNS rebinding) would reach a private address through `fetch`;
 * here the address connected to is the one checked. Redirects are not followed, and at most MAX_BYTES + 1 bytes are read.
 */
function pinnedFetch(resolver: Resolver): Fetcher {
  const checked: LookupFunction = (host, options, done) => {
    resolver(host).then(
      (addresses) => {
        if (!addresses.length || !addresses.every(isPublic)) return done(Object.assign(new Error("not a public address"), { code: "EREFUSED" }), "", 4);
        const all = addresses.map((address) => ({ address, family: isIP(address) }));
        if (options.all) done(null, all);
        else done(null, all[0].address, all[0].family);
      },
      (e: NodeJS.ErrnoException) => done(e, "", 4),
    );
  };
  return (url, init) =>
    new Promise((ok, fail) => {
      const req = get(url, { headers: init.headers, signal: init.signal, lookup: checked }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size > MAX_BYTES) res.destroy();
        });
        const answer = () => {
          const status = res.statusCode ?? 502;
          ok(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status: status < 200 || status > 599 ? 502 : status }));
        };
        res.on("end", answer);
        res.on("close", answer); // destroyed past MAX_BYTES: what was read is enough to refuse it
        res.on("error", fail);
      });
      req.on("error", fail);
    });
}

/** Fetches the card at `url`: the card, or why not. Redirects are not followed and at most 64 KB are read. */
export async function fetchCard(url: string, fetchFn?: Fetcher, resolver: Resolver = resolve): Promise<Card | CardFailure> {
  if (!(await fetchable(url, resolver))) return "refused";
  // e2e serves cards over http from this same server, which pinnedFetch would refuse.
  const fetcher = fetchFn ?? (config.e2e() ? (u, init) => fetch(u, { ...init, redirect: "manual" }) : pinnedFetch(resolver));
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "text/vcard" } });
    if (res.status === 404 || res.status === 410) return "not_found";
    if (!res.ok) return "unreachable";
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return "not_a_card";
    return parseVCard(new TextDecoder().decode(body)) ?? "not_a_card";
  } catch (e) {
    // A network error's message can name the URL, which is a credential: only its type is logged.
    log.warn({ err: { type: errorFields(e).type } }, "fetching a card failed");
    return "unreachable";
  }
}

async function store(personId: string, got: Card | CardFailure): Promise<PersonCard> {
  const d = await db();
  if (typeof got === "string") {
    await d.updateTable("card_subscriptions").set({ failed: got, tried_at: now() }).where("person_id", "=", personId).execute();
  } else {
    await d
      .updateTable("card_subscriptions")
      .set({ card: JSON.stringify(got), fetched_at: now(), tried_at: now(), failed: null })
      .where("person_id", "=", personId)
      .execute();
  }
  return (await personCard(personId))!;
}

/**
 * Subscribes the person to the card at `url`, replacing any card they had, and fetches it once now. A URL that can't be
 * fetched at all (not https, or not a public address) is refused before anything is kept.
 */
export async function subscribeCard(v: Viewer, personId: string, url: string, fetchFn?: Fetcher, resolver: Resolver = resolve): Promise<PersonCard> {
  const u = url.trim();
  if (!(await fetchable(u, resolver))) throw new InvalidInputError("A card link must be an https address on the internet");
  const d = await db();
  if (!(await d.selectFrom("persons").select("id").where("id", "=", personId).executeTakeFirst())) throw new NotFoundError("No such person");
  await d
    .insertInto("card_subscriptions")
    .values({ person_id: personId, url: u, card: null, fetched_at: null, tried_at: null, failed: null, added_by: v.userId, created_at: now() })
    .onConflict((oc) => oc.column("person_id").doUpdateSet({ url: u, card: null, fetched_at: null, tried_at: null, failed: null, added_by: v.userId }))
    .execute();
  return store(personId, await fetchCard(u, fetchFn, resolver));
}

/** Drops the person's card and its link. Shared like the name, so either user may (ADR 0011). */
export async function unsubscribeCard(personId: string): Promise<void> {
  await (await db()).deleteFrom("card_subscriptions").where("person_id", "=", personId).execute();
}

/** The person's subscribed card, or null when they have none. Shared like the name: every user of the household sees it. */
export async function personCard(personId: string): Promise<PersonCard | null> {
  const r = await (await db()).selectFrom("card_subscriptions").select(["card", "fetched_at", "failed"]).where("person_id", "=", personId).executeTakeFirst();
  return r ? { card: r.card ? (JSON.parse(r.card) as Card) : null, fetchedAt: r.fetched_at, failed: (r.failed as CardFailure | null) ?? null } : null;
}

const DAY = 86_400_000;

/** Fetches every card not tried in the last day, one after another. Returns how many came back. */
export async function refreshCards(at = now(), fetchFn?: Fetcher, resolver: Resolver = resolve): Promise<number> {
  const rows = await (
    await db()
  )
    .selectFrom("card_subscriptions")
    .select(["person_id", "url"])
    .where((eb) => eb.or([eb("tried_at", "is", null), eb("tried_at", "<", at - DAY)]))
    .execute();
  let fetched = 0;
  for (const r of rows) {
    const got = await fetchCard(r.url, fetchFn, resolver);
    await store(r.person_id, got);
    if (typeof got !== "string") fetched++;
  }
  if (rows.length) log.info({ cards: rows.length, fetched }, "cards refreshed");
  return fetched;
}
