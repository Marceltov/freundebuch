// Recording a conversation: the one write path for what Claude extracts from a ramble. Everything lands in one transaction, so a
// bad item leaves nothing behind. Privacy is decided here once: a private conversation makes every item private, and any private
// item makes the verbatim transcript private to the recorder (it contains the private part).
import type { Kysely } from "kysely";
import { addDays, assertDay, isDay, isYearless, notFuture, today } from "./dates";
import { db, newId, now, type Schema } from "./db";
import { AmbiguousError, InvalidInputError, NotFoundError } from "./errors";
import { insertExperiences, validateExperiences, type NewExperience, type RecordedExperience } from "./experiences";
import { checkLook, lookJson } from "./looks";
import { fileOwners, fileOwnersOf, ownersOf, resolvePlace, type PlaceRef } from "./places";
import { checkGender, insertPerson, namedLike, relabelFor, type Relabel } from "./people";
import {
  CONVERSATION_KINDS,
  EXCHANGE_KINDS,
  FACT_CATEGORIES,
  FACT_KINDS,
  VISIBILITIES,
  type ConversationKind,
  type ExchangeKind,
  type FactCategory,
  type FactKind,
  type Gender,
  type Viewer,
  type Visibility,
} from "./types";
import { dropBlobs, takeFiles } from "./files";
import { resolveOrCreateGroup } from "./groups";
import { isHouseholdWord, resolvePairs, type Target } from "./household";
import { conversationPath, groupPath, itemPath, journalPath, personPath, type AnchoredTable } from "./urls";
import { visible } from "./visibility";

/** What heads a shared file's transcript inside a conversation's. */
export const FROM_FILE = "--- Aus einer geteilten Datei ---";

/** An index into `NewConversation.people`. */
export type PersonRef = number;
type DateKind = "birthday" | "anniversary" | "custom";
type Direction = "to_them" | "from_them";

export type NewConversation = {
  /** Shared files this conversation was told from (files.ts): the user's own waiting files. Their transcripts join this one,
   * and the files go. */
  fileIds?: string[];
  date: string;
  kind: ConversationKind;
  place?: PlaceRef<PersonRef>;
  summary: string;
  transcript: string;
  visibility: Visibility;
  /**
   * `id` links an existing person, `name` creates one. `present` makes them a participant. A new name that matches an existing
   * person's name or alias is refused as ambiguous unless `confirmedNew`.
   */
  people: Array<{ id?: string; name?: string; aliases?: string[]; present: boolean; confirmedNew?: boolean; gender?: Gender }>;
  facts?: Array<{ person: PersonRef; text: string; category: FactCategory; private?: boolean; supersedes?: string; kind?: FactKind; checkAfter?: string }>;
  promises?: Array<{ person: PersonRef; text: string; byMe: boolean; due?: string; private?: boolean }>;
  /** `date` is `YYYY-MM-DD`, or `--MM-DD` for a yearly date without a year. */
  dates?: Array<{ person: PersonRef; kind: DateKind; date: string; label?: string; yearly: boolean; private?: boolean }>;
  exchanges?: Array<{ person: PersonRef; kind: ExchangeKind; direction: Direction; text: string; amount?: number; currency?: string; private?: boolean }>;
  /** "me" is the viewer's person, "us" every household person (one relationship each): a role to us ("our landlady"). */
  /** `label` is what `from` is to `to`, `inverse` what `to` is to `from`, in words and in each one's gender ("Vermieterin", "Mieter"). */
  relationships?: Array<{ from: PersonRef | "me" | "us"; to: PersonRef | "me" | "us"; label: string; inverse: string; note?: string; private?: boolean }>;
  groups?: Array<{ name: string; members: PersonRef[]; private?: boolean }>;
};

const ITEM_KINDS = ["facts", "promises", "dates", "exchanges", "relationships", "groups"] as const;

export type Recorded = {
  conversationId: string;
  url: string;
  people: Array<{ ref: PersonRef; id: string; name: string; created: boolean; url: string }>;
  /** Items written; `groups` counts the group memberships written. */
  counts: Record<(typeof ITEM_KINDS)[number], number>;
  filed: Filed & { relationships: FiledRelationship[]; groups: FiledGroup[] };
};

/** What was filed, item by item, each with the person it is about (`name`) and its row (`url`). Only the viewer's own rows. */
type FiledItem = { id: string; personId: string; name: string; visibility: Visibility; url: string };
/** `defaultCheckAfter`: the server chose checkAfter (SITUATION_DAYS from now) because none was given. */
export type FiledFact = FiledItem & { text: string; kind: FactKind; checkAfter: string | null; defaultCheckAfter: boolean; supersedes: string | null };
export type Filed = {
  facts: FiledFact[];
  promises: Array<FiledItem & { text: string; byMe: boolean; due: string | null }>;
  dates: Array<FiledItem & { kind: DateKind; date: string; label: string | null; yearly: boolean }>;
  exchanges: Array<FiledItem & { kind: ExchangeKind; direction: Direction; text: string }>;
};
/**
 * A relationship as filed. `created` is false when the recorder already saw the same one (theirs, or a shared one), which was kept
 * with its own words; the other user's private relationships are never compared, so one of theirs never shows here.
 */
export type FiledRelationship = { id: string; fromId: string; fromName: string; toId: string; toName: string; label: string; inverse: string; created: boolean; url: string };
/** `already`: the members the viewer had put in the group before; only their own memberships count. */
export type FiledGroup = { id: string; name: string; added: number; already: number; url: string };

/** `url`: the item's row on the conversation's page, which lists everything filed from it, done and outdated ones too. */
type Item = { id: string; visibility: Visibility; recordedBy: string; url: string };
/** `name`: the name of the person the item is about. */
type About = { personId: string; name: string };
export type ConversationView = {
  id: string;
  date: string;
  kind: ConversationKind;
  /** Where it happened: the place's name, and its id (null when none was told). */
  place: string | null;
  placeId: string | null;
  /** The experience it happened at, if the viewer may see it. */
  experienceId: string | null;
  summary: string;
  /** The ramble it was told in. */
  rambleId: string;
  /** The ramble's transcript; null when the viewer may not read it: it is private to the recorder whenever anything told in the ramble is private. */
  transcript: string | null;
  visibility: Visibility;
  recordedBy: string;
  url: string;
  participants: Array<{ id: string; name: string; url: string }>;
  facts: Array<Item & About & { text: string; category: FactCategory; status: "current" | "outdated" }>;
  /** `byMe` and `by` as in a briefing: from the viewer's side, with the other user's name when they made the promise. */
  promises: Array<Item & About & { text: string; byMe: boolean; by?: string; due: string | null; done: boolean }>;
  dates: Array<Item & About & { kind: DateKind; date: string; label: string | null; yearly: boolean }>;
  /** `by`: the other user's name when they recorded it; `direction` then reads from their side. */
  exchanges: Array<
    Item & About & { kind: ExchangeKind; direction: Direction; by?: string; text: string; amount: number | null; currency: string | null; settled: boolean }
  >;
  relationships: Array<Item & { fromId: string; fromName: string; toId: string; toName: string; label: string; inverse: string; note: string | null }>;
};

export const MAX_TRANSCRIPT = 200_000;
/** How long after filing a situation without a `checkAfter` it turns into a nudge to ask how it went. */
export const SITUATION_DAYS = 42;
export const MAX_SUMMARY = 2_000;

function oneOf<T extends string>(value: string, allowed: readonly T[], what: string): void {
  if (!allowed.includes(value as T)) throw new InvalidInputError(`Unknown ${what} "${value}"`);
}

/** Everything that can be checked without the database, so most bad input fails before the transaction starts. */
function validate(c: NewConversation): void {
  assertDay(c.date, "The conversation date");
  notFuture(c.date, "The conversation date");
  oneOf(c.kind, CONVERSATION_KINDS, "conversation kind");
  checkVisibility(c.visibility);
  if (c.summary.length > MAX_SUMMARY) throw new InvalidInputError(`The summary holds at most ${MAX_SUMMARY} characters`);
  if (c.transcript.length > MAX_TRANSCRIPT) throw new InvalidInputError(`The transcript holds at most ${MAX_TRANSCRIPT} characters`);
  for (const p of c.people) {
    if (!p.id && !p.name?.trim()) throw new InvalidInputError("Each person needs an id (existing) or a name (new)");
    if (p.gender !== undefined) checkGender(p.gender);
  }
  const ref = (r: PersonRef) => {
    if (!Number.isInteger(r) || r < 0 || r >= c.people.length) throw new InvalidInputError(`Person ${r} is not in people`);
  };
  validateItems(c, ref);
  for (const r of c.relationships ?? []) checkRelationship(r, ref);
  for (const g of c.groups ?? []) checkGroup(g, ref);
}

/**
 * A fact is `lasting` or a `situation` (going on, will end) with `checkAfter`, the day to ask how it went; SITUATION_DAYS after it
 * was filed when a new situation gives none. A fact that supersedes another takes its kind unless it gives one, so news keeps a
 * situation going, and news about a situation must give its new checkAfter.
 */
type Items<P> = {
  facts?: Array<{ person: P; text: string; category: string; private?: boolean; supersedes?: string; kind?: string; checkAfter?: string }>;
  promises?: Array<{ person: P; text: string; byMe: boolean; due?: string; private?: boolean }>;
  dates?: Array<{ person: P; kind: string; date: string; label?: string; yearly: boolean; private?: boolean }>;
  exchanges?: Array<{ person: P; kind: string; direction: string; text: string; amount?: number; currency?: string; private?: boolean }>;
};

/** The checks of facts, promises, dates and exchanges, shared with remember(). `ref` checks one person reference. */
function validateItems<P>(c: Items<P>, ref: (p: P) => void): void {
  for (const f of c.facts ?? []) {
    ref(f.person);
    oneOf(f.category, FACT_CATEGORIES, "fact category");
    if (f.kind !== undefined) oneOf(f.kind, FACT_KINDS, "fact kind");
    if (f.checkAfter !== undefined) assertDay(f.checkAfter, "A situation's checkAfter");
  }
  for (const p of c.promises ?? []) {
    ref(p.person);
    if (p.due !== undefined) assertDay(p.due, "A promise's due date");
  }
  for (const d of c.dates ?? []) {
    ref(d.person);
    oneOf(d.kind, ["birthday", "anniversary", "custom"], "date kind");
    if (!isDay(d.date) && !(d.yearly && isYearless(d.date))) throw new InvalidInputError(`A date must be a real date as YYYY-MM-DD, or --MM-DD when yearly; got "${d.date}"`);
  }
  for (const e of c.exchanges ?? []) {
    ref(e.person);
    oneOf(e.kind, EXCHANGE_KINDS, "exchange kind");
    oneOf(e.direction, ["to_them", "from_them"], "direction");
  }
}

/**
 * Writes facts, promises, dates and exchanges, with or without a conversation (`base.conversation_id`); shared with remember().
 * Returns them as filed; `name` gives the name of the person an item is about, `page` the page that shows its row.
 */
async function insertItems<P>(
  tx: Kysely<Schema>,
  v: Viewer,
  base: ItemBase,
  c: Items<P>,
  id: (p: P) => string,
  vis: (item: { private?: boolean }) => Visibility,
  name: (personId: string) => string,
  page: (personId: string) => string,
): Promise<Filed> {
  const filed: Filed = { facts: [], promises: [], dates: [], exchanges: [] };
  const about = (table: AnchoredTable, itemId: string, personId: string, visibility: Visibility) => ({ id: itemId, personId, name: name(personId), visibility, url: itemPath(page(personId), table, itemId) });
  for (const f of c.facts ?? []) {
    const factId = newId();
    const replaced = f.supersedes
      ? await tx.selectFrom("facts").select("kind").where("id", "=", f.supersedes).$call((qb) => visible(qb, v, "facts")).executeTakeFirst()
      : undefined;
    const kind = (f.kind ?? replaced?.kind ?? "lasting") as FactKind;
    if (kind !== "situation" && f.checkAfter !== undefined) throw new InvalidInputError("checkAfter is for a situation; a lasting fact or trait has none");
    // News sets the day afresh: how long until it is worth asking again is agreed with the user, never carried over.
    if (replaced?.kind === "situation" && kind === "situation" && f.checkAfter === undefined)
      throw new InvalidInputError("News about a situation needs a new checkAfter: suggest when to ask again and agree it with the user");
    const checkAfter = kind === "situation" ? (f.checkAfter ?? addDays(today(), SITUATION_DAYS)) : null;
    await tx
      .insertInto("facts")
      .values({ ...base, id: factId, person_id: id(f.person), text: f.text, category: f.category, kind, check_after: checkAfter, visibility: vis(f) })
      .execute();
    if (f.supersedes) await outdate(tx, v, f.supersedes, factId, id(f.person), vis(f));
    filed.facts.push({ ...about("facts", factId, id(f.person), vis(f)), text: f.text, kind, checkAfter, defaultCheckAfter: kind === "situation" && f.checkAfter === undefined, supersedes: f.supersedes ?? null });
  }
  for (const p of c.promises ?? []) {
    const promiseId = newId();
    await tx.insertInto("promises").values({ ...base, id: promiseId, person_id: id(p.person), text: p.text, by_me: p.byMe ? 1 : 0, due: p.due ?? null, visibility: vis(p) }).execute();
    filed.promises.push({ ...about("promises", promiseId, id(p.person), vis(p)), text: p.text, byMe: p.byMe, due: p.due ?? null });
  }
  for (const d of c.dates ?? []) {
    const dateId = newId();
    await tx
      .insertInto("dates")
      .values({ ...base, id: dateId, person_id: id(d.person), kind: d.kind as DateKind, date: d.date, label: d.label ?? null, yearly: d.yearly ? 1 : 0, visibility: vis(d) })
      .execute();
    filed.dates.push({ ...about("dates", dateId, id(d.person), vis(d)), kind: d.kind as DateKind, date: d.date, label: d.label ?? null, yearly: d.yearly });
  }
  for (const e of c.exchanges ?? []) {
    const exchangeId = newId();
    await tx
      .insertInto("exchanges")
      .values({ ...base, id: exchangeId, person_id: id(e.person), kind: e.kind, direction: e.direction as "to_them" | "from_them", text: e.text, amount: e.amount ?? null, currency: e.currency ?? null, visibility: vis(e) })
      .execute();
    filed.exchanges.push({ ...about("exchanges", exchangeId, id(e.person), vis(e)), kind: e.kind as ExchangeKind, direction: e.direction as Direction, text: e.text });
  }
  return filed;
}

/**
 * Facts, promises, dates and exchanges about people the book already has, filed without a conversation: "Malou's birthday is 7
 * February". `genders` sets (null: clears) a person's gender, shared like the name; like setGender, each comes back with the
 * person's relationships the viewer recorded, to put in it. `looks` sets (null: clears) the parts of a person's avatar.
 */
export type Remembered = {
  visibility: Visibility;
  genders?: Array<{ person: string; gender: Gender | null }>;
  looks?: Array<{ person: string; look: unknown }>;
  /** Where someone lives: a place (as record names one) that is their home. */
  homes?: Array<{ person: string; place: PlaceRef<unknown>; private?: boolean }>;
} & Items<string>;
type RememberCounts = { facts: number; promises: number; dates: number; exchanges: number; genders: number; looks: number; homes: number };

export async function remember(v: Viewer, r: Remembered): Promise<{
  counts: RememberCounts;
  people: Array<{ id: string; name: string; url: string }>;
  filed: Filed;
  genders: Array<{ person: string; gender: Gender | null; relabel: Relabel[] }>;
}> {
  checkVisibility(r.visibility);
  const count = (r.facts?.length ?? 0) + (r.promises?.length ?? 0) + (r.dates?.length ?? 0) + (r.exchanges?.length ?? 0) + (r.genders?.length ?? 0) + (r.looks?.length ?? 0) + (r.homes?.length ?? 0);
  if (!count) throw new InvalidInputError("Nothing to remember: give at least one fact, promise, date, exchange, gender, look or home");
  const person = (p: unknown) => {
    if (typeof p !== "string" || !p) throw new InvalidInputError("Each item needs the id of an existing person");
  };
  validateItems(r, person);
  for (const g of r.genders ?? []) {
    person(g.person);
    checkGender(g.gender);
  }
  const looks = (r.looks ?? []).map((l) => {
    person(l.person);
    return { person: l.person, look: l.look === null ? null : checkLook(l.look) };
  });
  for (const h of r.homes ?? []) {
    person(h.person);
    if (!h.place) throw new InvalidInputError("A home needs a place");
    if (ownersOf(h.place).length) throw new InvalidInputError("A home is its person's: leave owners out of its place");
  }
  const vis = (item: { private?: boolean }): Visibility => (r.visibility === "private" || item.private ? "private" : "shared");
  const base: ItemBase = { recorded_by: v.userId, conversation_id: null, created_at: now() };
  return (await db()).transaction().execute(async (tx) => {
    const ids = [...new Set([...(r.facts ?? []), ...(r.promises ?? []), ...(r.dates ?? []), ...(r.exchanges ?? []), ...(r.genders ?? []), ...looks, ...(r.homes ?? [])].map((i) => i.person))];
    const people = await tx.selectFrom("persons").select(["id", "name"]).where("id", "in", ids).execute();
    if (people.length !== ids.length) throw new NotFoundError("No such person");
    const genders: Array<{ person: string; gender: Gender | null; relabel: Relabel[] }> = [];
    for (const g of r.genders ?? []) {
      const before = await tx.selectFrom("persons").select("gender").where("id", "=", g.person).executeTakeFirstOrThrow();
      await tx.updateTable("persons").set({ gender: g.gender }).where("id", "=", g.person).execute();
      genders.push({ ...g, relabel: await relabelFor(tx, v, g.person, before.gender, g.gender) });
    }
    for (const l of looks) await tx.updateTable("persons").set({ look: lookJson(l.look) }).where("id", "=", l.person).execute();
    const names = new Map(people.map((p) => [p.id, p.name]));
    const filed = await insertItems(tx, v, base, r, (p) => p, vis, (p) => names.get(p) ?? "", personPath);
    for (const h of r.homes ?? []) await fileOwners(tx, v, await resolvePlace(tx, v, h.place, vis(h)), [h.person], vis(h));
    return {
      filed,
      genders,
      counts: { facts: r.facts?.length ?? 0, promises: r.promises?.length ?? 0, dates: r.dates?.length ?? 0, exchanges: r.exchanges?.length ?? 0, genders: r.genders?.length ?? 0, looks: looks.length, homes: r.homes?.length ?? 0 },
      people: people.map((p) => ({ id: p.id, name: p.name, url: personPath(p.id) })),
    };
  });
}

// The checks and writers of relationships and group memberships, shared with relate (relationships.ts), which records them
// without a conversation. `ref` checks one person reference: an index here, a person id there.

export function checkVisibility(visibility: string): void {
  oneOf(visibility, VISIBILITIES, "visibility");
}

/** `from` and `to` may be "me" or "us" (household.ts), but not both. */
export function checkRelationship<P>(r: { from: P | "me" | "us"; to: P | "me" | "us"; label: string; inverse: string }, ref: (p: P) => void): void {
  if (isHouseholdWord(r.from) && isHouseholdWord(r.to)) throw new InvalidInputError('A relationship needs someone outside the household on one end: "me" and "us" can\'t both be used');
  if (!isHouseholdWord(r.from)) ref(r.from);
  if (!isHouseholdWord(r.to)) ref(r.to);
  checkLabel(r.label, "label");
  checkLabel(r.inverse, "inverse");
  if (r.from === r.to) throw new InvalidInputError("A relationship needs two different people");
}

export const MAX_LABEL = 60;

export function checkLabel(word: unknown, what: string): void {
  if (typeof word !== "string" || !word.trim()) throw new InvalidInputError(`A relationship's ${what} says in words what that end is ("Vermieterin", "Mieter")`);
  if (word.trim().length > MAX_LABEL) throw new InvalidInputError(`A relationship's ${what} holds at most ${MAX_LABEL} characters`);
}

export function checkGroup<P>(g: { name: string; members: P[] }, ref: (p: P) => void): void {
  if (!g.name.trim()) throw new InvalidInputError("A group needs a name");
  g.members.forEach(ref);
}

/** Who recorded an item, when, and with which conversation and ramble (null for one set directly). */
export type ItemBase = { recorded_by: string; conversation_id: string | null; ramble_id?: string | null; created_at: number };

/**
 * A relationship's word with its gender endings taken off, so "Vermieterin", "Vermieter" and "Vermieter:in" are one word, and
 * "Kollege" and "Kollegin" too; umlauts fold ("Ärztin", "Arzt").
 */
export function labelKey(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[:*_/](in(nen)?|r)$/, "")
    .replace(/e$/, "")
    .replace(/in$/, "");
}

/** The same relationship whichever way round it is written: A Mutter of B, Sohn B is B Sohn of A, Mutter A. */
export function sameRelationship(
  a: { from_id: string; to_id: string; label: string; inverse: string },
  b: { from_id: string; to_id: string; label: string; inverse: string },
): boolean {
  const k = (x: typeof a) => [labelKey(x.label), labelKey(x.inverse)];
  const [al, ai] = k(a);
  const [bl, bi] = k(b);
  return (a.from_id === b.from_id && a.to_id === b.to_id && al === bl && ai === bi) || (a.from_id === b.to_id && a.to_id === b.from_id && al === bi && ai === bl);
}

/**
 * Records a relationship, unless the recorder already sees the same one (theirs, or a shared one): then that one comes back with
 * its own words and `created` false, and it takes the note if it had none and is the recorder's.
 */
export async function insertRelationship(
  tx: Kysely<Schema>,
  base: ItemBase,
  r: { fromId: string; toId: string; label: string; inverse: string; note?: string; visibility: Visibility },
): Promise<{ id: string; fromId: string; toId: string; label: string; inverse: string; created: boolean }> {
  const row = { from_id: r.fromId, to_id: r.toId, label: r.label.trim(), inverse: r.inverse.trim() };
  const known = await tx
    .selectFrom("relationships")
    .select(["id", "from_id", "to_id", "label", "inverse", "note", "recorded_by"])
    .where((eb) => eb.or([eb.and([eb("from_id", "=", r.fromId), eb("to_id", "=", r.toId)]), eb.and([eb("from_id", "=", r.toId), eb("to_id", "=", r.fromId)])]))
    .where((eb) => eb.or([eb("recorded_by", "=", base.recorded_by), eb("visibility", "=", "shared")]))
    .orderBy("created_at")
    .execute();
  const same = known.find((k) => sameRelationship(k, row));
  if (same) {
    if (!same.note?.trim() && r.note?.trim() && same.recorded_by === base.recorded_by) await tx.updateTable("relationships").set({ note: r.note }).where("id", "=", same.id).execute();
    return { id: same.id, fromId: same.from_id, toId: same.to_id, label: same.label, inverse: same.inverse, created: false };
  }
  const id = newId();
  await tx.insertInto("relationships").values({ ...base, ...row, id, note: r.note?.trim() || null, visibility: r.visibility }).execute();
  return { id, fromId: r.fromId, toId: r.toId, label: row.label, inverse: row.inverse, created: true };
}

/**
 * Records a relationship between targets (household.ts), one per pair they stand for, each deduped by insertRelationship. Each links
 * to its row on the page of `from`, or of `to` when from is "me" or "us".
 */
export async function insertRelationships(
  tx: Kysely<Schema>,
  v: Viewer,
  base: ItemBase,
  r: { from: Target; to: Target; label: string; inverse: string; note?: string; visibility: Visibility },
): Promise<FiledRelationship[]> {
  const pairs = await resolvePairs(tx, v, r.from, r.to);
  if (!pairs.length) throw new InvalidInputError("A relationship needs two different people");
  const out: FiledRelationship[] = [];
  for (const [fromId, toId] of pairs) {
    const x = await insertRelationship(tx, base, { fromId, toId, label: r.label, inverse: r.inverse, note: r.note, visibility: r.visibility });
    const names = new Map((await tx.selectFrom("persons").select(["id", "name"]).where("id", "in", [x.fromId, x.toId]).execute()).map((p) => [p.id, p.name]));
    const page = isHouseholdWord(r.from) ? toId : fromId;
    out.push({ ...x, fromName: names.get(x.fromId) ?? "", toName: names.get(x.toId) ?? "", url: itemPath(personPath(page), "relationships", x.id) });
  }
  return out;
}

/** Adds the people to the group this name resolves to for the viewer (created when none does); returns it and how many memberships were new. */
export async function insertMemberships(
  tx: Kysely<Schema>,
  v: Viewer,
  base: ItemBase,
  name: string,
  personIds: string[],
  visibility: Visibility,
): Promise<{ added: number; groupId: string }> {
  const groupId = await resolveOrCreateGroup(tx, v, name);
  let added = 0;
  // Each user has their own membership row. One the viewer recorded before keeps its visibility; only they may change it.
  for (const m of new Set(personIds)) {
    const r = await tx
      .insertInto("group_members")
      .values({ group_id: groupId, person_id: m, visibility, recorded_by: base.recorded_by, conversation_id: base.conversation_id, ramble_id: base.ramble_id ?? null })
      .onConflict((oc) => oc.doNothing())
      .executeTakeFirst();
    added += Number(r.numInsertedOrUpdatedRows ?? 0);
  }
  return { added, groupId };
}

/**
 * Refuses to create a person who may already exist: a new name equal to an existing person's name or alias, once normalised,
 * unless the entry says `confirmedNew`. The message lists each candidate with the hints the viewer may see.
 */
async function assertNoNamesake(v: Viewer, c: { people: Array<{ id?: string; name?: string; confirmedNew?: boolean }> }): Promise<void> {
  const found: string[] = [];
  for (const p of c.people) {
    if (p.id || p.confirmedNew) continue;
    const candidates = await namedLike(v, p.name!);
    if (!candidates.length) continue;
    const list = candidates.map((x) => `${x.name} (id ${x.id}${x.context.length ? `; ${x.context.join(", ")}` : ""})`).join("; ");
    found.push(`"${p.name!.trim()}" may already be ${candidates.length > 1 ? "one of " : ""}${list}`);
  }
  if (found.length)
    throw new AmbiguousError(`${found.join(". ")}. Link an existing person by id, or set confirmedNew: true on a person the user confirmed is someone new`);
}

/** The longest journal entry: a thought, not a transcript. */
export const MAX_JOURNAL = 20_000;

/** A part of a ramble that came out of one of its conversations (`in`, an index into `conversations`); without, the ramble's own. */
type In = { in?: number };
/**
 * One ramble, as Claude splits it: who it is about (`people`, named once), the conversations it tells of, the journal entries
 * about the user, and what was learned, each item `in` the conversation it came from. Journal entries are private unless
 * `shared`. At least one part.
 */
export type NewRamble = {
  fileIds?: string[];
  date: string;
  transcript: string;
  visibility: Visibility;
  people: Array<{ id?: string; name?: string; aliases?: string[]; confirmedNew?: boolean; gender?: Gender }>;
  conversations?: Array<{ date?: string; kind: ConversationKind; place?: PlaceRef<PersonRef>; summary: string; present: PersonRef[]; /** The experience (index) it happened at. */ at?: number }>;
  experiences?: NewExperience[];
  journal?: Array<{ date?: string; text: string; mentions?: PersonRef[]; shared?: boolean }>;
  facts?: Array<NonNullable<NewConversation["facts"]>[number] & In>;
  promises?: Array<NonNullable<NewConversation["promises"]>[number] & In>;
  dates?: Array<NonNullable<NewConversation["dates"]>[number] & In>;
  exchanges?: Array<NonNullable<NewConversation["exchanges"]>[number] & In>;
  relationships?: Array<NonNullable<NewConversation["relationships"]>[number] & In>;
  groups?: Array<NonNullable<NewConversation["groups"]>[number] & In>;
};

export type RecordedRamble = Omit<Recorded, "conversationId" | "url"> & {
  rambleId: string;
  conversations: Array<{ id: string; url: string }>;
  journal: Array<{ id: string; visibility: Visibility; url: string }>;
  experiences: RecordedExperience[];
};

function validateRamble(r: NewRamble): void {
  assertDay(r.date, "The ramble's date");
  notFuture(r.date, "The ramble's date");
  checkVisibility(r.visibility);
  if (r.transcript.length > MAX_TRANSCRIPT) throw new InvalidInputError(`The transcript holds at most ${MAX_TRANSCRIPT} characters`);
  for (const p of r.people) {
    if (!p.id && !p.name?.trim()) throw new InvalidInputError("Each person needs an id (existing) or a name (new)");
    if (p.gender !== undefined) checkGender(p.gender);
  }
  const ref = (x: PersonRef) => {
    if (!Number.isInteger(x) || x < 0 || x >= r.people.length) throw new InvalidInputError(`Person ${x} is not in people`);
  };
  const conversations = r.conversations ?? [];
  for (const c of conversations) {
    if (c.date !== undefined) {
      assertDay(c.date, "The conversation date");
      notFuture(c.date, "The conversation date");
    }
    oneOf(c.kind, CONVERSATION_KINDS, "conversation kind");
    if (c.summary.length > MAX_SUMMARY) throw new InvalidInputError(`The summary holds at most ${MAX_SUMMARY} characters`);
    c.present.forEach(ref);
    for (const o of ownersOf(c.place)) if (!isHouseholdWord(o)) ref(o);
    if (c.at !== undefined && (!Number.isInteger(c.at) || c.at < 0 || c.at >= (r.experiences ?? []).length)) throw new InvalidInputError(`Experience ${c.at} is not in experiences`);
  }
  validateExperiences(r.experiences ?? [], r.people.length);
  for (const j of r.journal ?? []) {
    if (j.date !== undefined) {
      assertDay(j.date, "The journal entry's date");
      notFuture(j.date, "The journal entry's date");
    }
    if (!j.text.trim()) throw new InvalidInputError("A journal entry needs its text");
    if (j.text.length > MAX_JOURNAL) throw new InvalidInputError(`A journal entry holds at most ${MAX_JOURNAL} characters`);
    (j.mentions ?? []).forEach(ref);
  }
  validateItems(r, ref);
  for (const x of r.relationships ?? []) checkRelationship(x, ref);
  for (const g of r.groups ?? []) checkGroup(g, ref);
  const items = [...(r.facts ?? []), ...(r.promises ?? []), ...(r.dates ?? []), ...(r.exchanges ?? []), ...(r.relationships ?? []), ...(r.groups ?? [])];
  for (const i of items)
    if (i.in !== undefined && (!Number.isInteger(i.in) || i.in < 0 || i.in >= conversations.length))
      throw new InvalidInputError(`Conversation ${i.in} is not in conversations`);
  if (!conversations.length && !(r.journal ?? []).length && !(r.experiences ?? []).length && !items.length)
    throw new InvalidInputError("Nothing to file: give at least one conversation, experience, journal entry or item");
}

/** Files one ramble and all its parts in one transaction: the transcript once, everything else pointing to it. */
export async function record(v: Viewer, r: NewRamble): Promise<RecordedRamble> {
  validateRamble(r);
  await assertNoNamesake(v, r);
  const vis = (item: { private?: boolean }): Visibility => (r.visibility === "private" || item.private ? "private" : "shared");
  const journalVis = (j: { shared?: boolean }): Visibility => (r.visibility === "shared" && j.shared ? "shared" : "private");
  const items = [...(r.facts ?? []), ...(r.promises ?? []), ...(r.dates ?? []), ...(r.exchanges ?? []), ...(r.relationships ?? []), ...(r.groups ?? [])];
  const transcriptPrivate = r.visibility === "private" || items.some((i) => i.private) || (r.journal ?? []).some((j) => journalVis(j) === "private") ? 1 : 0;
  const rambleId = newId();
  const conversationIds = (r.conversations ?? []).map(() => newId());
  const t = now();

  // The shared files it was told from: their transcripts join the ramble's, and the files go once it has committed.
  let blobs: string[] = [];
  const recorded = await (await db()).transaction().execute(async (tx) => {
    const taken = await takeFiles(tx, v, r.fileIds ?? []);
    blobs = taken.blobs;
    const transcript = [r.transcript, ...taken.transcripts.map((x) => `${FROM_FILE}\n${x}`)].join("\n\n");
    await tx.insertInto("rambles").values({ id: rambleId, date: r.date, transcript, transcript_private: transcriptPrivate, visibility: r.visibility, recorded_by: v.userId, created_at: t }).execute();
    const placeLevels: string[][] = [];
    for (const [i, c] of (r.conversations ?? []).entries()) {
      const levels: string[] = [];
      const placeId = c.place === undefined || c.place === "" ? null : await resolvePlace(tx, v, c.place, r.visibility, levels);
      placeLevels.push(levels);
      await tx
        .insertInto("conversations")
        .values({ id: conversationIds[i], date: c.date ?? r.date, kind: c.kind, place_id: placeId, summary: c.summary, ramble_id: rambleId, visibility: r.visibility, recorded_by: v.userId, created_at: t })
        .execute();
    }

    const people: Omit<Recorded["people"][number], "url">[] = [];
    for (const [ref, p] of r.people.entries()) {
      if (p.id) {
        const row = await tx.selectFrom("persons").select(["id", "name"]).where("id", "=", p.id).executeTakeFirst();
        if (!row) throw new NotFoundError(`No such person: ${p.id}`);
        if (p.gender) await tx.updateTable("persons").set({ gender: p.gender }).where("id", "=", row.id).execute();
        people.push({ ref, id: row.id, name: row.name, created: false });
      } else {
        const name = p.name!.trim();
        people.push({ ref, id: await insertPerson(tx, v, { name, aliases: p.aliases, createdFrom: conversationIds[0] ?? null, gender: p.gender }), name, created: true });
      }
    }
    const id = (x: PersonRef) => people[x].id;
    for (const [i, c] of (r.conversations ?? []).entries())
      for (const personId of new Set([v.personId, ...c.present.map(id)])) await tx.insertInto("participants").values({ conversation_id: conversationIds[i], person_id: personId }).execute();

    // Whose home a conversation's place is, once the people it names are known.
    for (const [i, c] of (r.conversations ?? []).entries()) await fileOwnersOf(tx, v, c.place, placeLevels[i], (o) => (isHouseholdWord(o) ? o : id(o)), r.visibility, rambleId);

    const experiences = await insertExperiences(tx, v, { rambleId, date: r.date, visibility: r.visibility }, r.experiences ?? [], people.map((p) => p.id), t);
    if (experiences.some((e) => e.visibility === "private")) await tx.updateTable("rambles").set({ transcript_private: 1 }).where("id", "=", rambleId).execute();
    for (const [i, c] of (r.conversations ?? []).entries())
      if (c.at !== undefined) await tx.updateTable("conversations").set({ experience_id: experiences[c.at].id }).where("id", "=", conversationIds[i]).execute();

    const journal: RecordedRamble["journal"] = [];
    for (const j of r.journal ?? []) {
      const entryId = newId();
      const visibility = journalVis(j);
      await tx.insertInto("journal_entries").values({ id: entryId, ramble_id: rambleId, date: j.date ?? r.date, text: j.text.trim(), visibility, recorded_by: v.userId, created_at: t }).execute();
      for (const personId of new Set((j.mentions ?? []).map(id))) await tx.insertInto("journal_mentions").values({ entry_id: entryId, person_id: personId }).execute();
      journal.push({ id: entryId, visibility, url: journalPath(entryId) });
    }

    // Items go with the conversation they came from (`in`), or with none: each group is written with its own base.
    const names = new Map(people.map((p) => [p.id, p.name]));
    const filed: Filed = { facts: [], promises: [], dates: [], exchanges: [] };
    const relationships: FiledRelationship[] = [];
    const groups: FiledGroup[] = [];
    const target = (x: PersonRef | "me" | "us") => (isHouseholdWord(x) ? x : id(x));
    const slots = [undefined, ...conversationIds.keys()] as Array<number | undefined>;
    for (const slot of slots) {
      const conversationId = slot === undefined ? null : conversationIds[slot];
      const mine = <T extends In>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.in === slot);
      const base: ItemBase = { recorded_by: v.userId, conversation_id: conversationId, ramble_id: rambleId, created_at: t };
      const page = (personId: string) => (conversationId ? conversationPath(conversationId) : personPath(personId));
      const part = { facts: mine(r.facts), promises: mine(r.promises), dates: mine(r.dates), exchanges: mine(r.exchanges) };
      const got = await insertItems(tx, v, base, part, id, vis, (p) => names.get(p) ?? "", page);
      for (const k of ["facts", "promises", "dates", "exchanges"] as const) (filed[k] as unknown[]).push(...got[k]);
      for (const x of mine(r.relationships)) relationships.push(...(await insertRelationships(tx, v, base, { from: target(x.from), to: target(x.to), label: x.label, inverse: x.inverse, note: x.note, visibility: vis(x) })));
      for (const g of mine(r.groups)) {
        const members = new Set(g.members.map(id)).size;
        const { added, groupId } = await insertMemberships(tx, v, base, g.name, g.members.map(id), vis(g));
        const { name } = await tx.selectFrom("groups").select("name").where("id", "=", groupId).executeTakeFirstOrThrow();
        groups.push({ id: groupId, name, added, already: members - added, url: groupPath(groupId) });
      }
    }

    const counts = {
      ...(Object.fromEntries(ITEM_KINDS.map((k) => [k, r[k]?.length ?? 0])) as Recorded["counts"]),
      relationships: relationships.length,
      groups: groups.reduce((n, g) => n + g.added, 0),
    };
    return {
      rambleId,
      conversations: conversationIds.map((c) => ({ id: c, url: conversationPath(c) })),
      journal,
      experiences,
      people: people.map((p) => ({ ...p, url: personPath(p.id) })),
      counts,
      filed: { ...filed, relationships, groups },
    };
  });
  await dropBlobs(blobs);
  return recorded;
}

/** One conversation as one ramble: everything learned in it is `in` it. */
export async function recordConversation(v: Viewer, c: NewConversation): Promise<Recorded> {
  validate(c);
  const inIt = <T>(xs: T[] | undefined) => xs?.map((x) => ({ ...x, in: 0 }));
  const r = await record(v, {
    fileIds: c.fileIds,
    date: c.date,
    transcript: c.transcript,
    visibility: c.visibility,
    people: c.people,
    conversations: [{ date: c.date, kind: c.kind, place: c.place, summary: c.summary, present: c.people.flatMap((p, i) => (p.present ? [i] : [])) }],
    facts: inIt(c.facts),
    promises: inIt(c.promises),
    dates: inIt(c.dates),
    exchanges: inIt(c.exchanges),
    relationships: inIt(c.relationships),
    groups: inIt(c.groups),
  });
  return { conversationId: r.conversations[0].id, url: r.conversations[0].url, people: r.people, counts: r.counts, filed: r.filed };
}

/** Why a private fact can't replace a shared one; corrections.ts refuses making such a replacement private later with the same words. */
export const PRIVATE_REPLACES_SHARED =
  "A private fact can't replace a shared one: record the update as shared, or keep the old fact and add the private one without supersedes";

/**
 * Marks a fact the viewer can see as outdated by `newId`; it must be about the same person as the fact that replaces it. A private
 * fact may only replace the viewer's own private fact: outdating a shared one would show the partner that something private changed.
 */
async function outdate(tx: Kysely<Schema>, v: Viewer, factId: string, newId: string, personId: string, visibility: Visibility): Promise<void> {
  const old = await tx
    .selectFrom("facts")
    .select(["person_id", "visibility"])
    .where("id", "=", factId)
    .$call((qb) => visible(qb, v, "facts"))
    .executeTakeFirst();
  if (!old) throw new NotFoundError(`No such fact: ${factId}`);
  if (old.person_id !== personId) throw new InvalidInputError("A fact can only supersede a fact about the same person");
  if (visibility === "private" && old.visibility !== "private") throw new InvalidInputError(PRIVATE_REPLACES_SHARED);
  await tx.updateTable("facts").set({ status: "outdated", superseded_by: newId }).where("id", "=", factId).execute();
}

/** Whether the viewer has filed anything yet; until then the start page says how to begin. */
export async function hasRecorded(v: Viewer): Promise<boolean> {
  return !!(await (await db()).selectFrom("conversations").select("id").where("recorded_by", "=", v.userId).limit(1).executeTakeFirst());
}

/** A conversation in the history: when, how, the summary, and who was there. */
export type ConversationSummary = { id: string; rambleId: string; date: string; kind: ConversationKind; summary: string; people: Array<{ id: string; name: string }>; url: string };

/** Every conversation the viewer may see, newest first. */
export async function listConversations(v: Viewer): Promise<ConversationSummary[]> {
  const d = await db();
  const convs = await d
    .selectFrom("conversations")
    .select(["id", "ramble_id", "date", "kind", "summary"])
    .$call((qb) => visible(qb, v, "conversations"))
    .orderBy("date", "desc")
    .orderBy("created_at", "desc")
    .execute();
  if (!convs.length) return [];
  const present = await d
    .selectFrom("participants")
    .innerJoin("persons", "persons.id", "participants.person_id")
    .select(["participants.conversation_id", "persons.id", "persons.name"])
    .where(
      "participants.conversation_id",
      "in",
      convs.map((c) => c.id),
    )
    .where("persons.id", "!=", v.personId)
    .orderBy("persons.name")
    .execute();
  return convs.map((c) => ({
    id: c.id,
    rambleId: c.ramble_id,
    date: c.date,
    kind: c.kind as ConversationKind,
    summary: c.summary,
    people: present.filter((p) => p.conversation_id === c.id).map((p) => ({ id: p.id, name: p.name })),
    url: conversationPath(c.id),
  }));
}

export async function getConversation(v: Viewer, id: string): Promise<ConversationView> {
  const d = await db();
  const c = await d.selectFrom("conversations").selectAll().where("id", "=", id).$call((qb) => visible(qb, v, "conversations")).executeTakeFirst();
  if (!c) throw new NotFoundError("No such conversation");
  const ramble = await d.selectFrom("rambles").select(["transcript", "transcript_private"]).where("id", "=", c.ramble_id).executeTakeFirstOrThrow();
  const participants = await d
    .selectFrom("participants")
    .innerJoin("persons", "persons.id", "participants.person_id")
    .select(["persons.id", "persons.name"])
    .where("participants.conversation_id", "=", id)
    .orderBy("persons.name")
    .execute();
  const page = conversationPath(id);
  const item = (table: AnchoredTable, r: { id: string; visibility: string; recorded_by: string }): Item => ({
    id: r.id,
    visibility: r.visibility as Visibility,
    recordedBy: r.recorded_by,
    url: itemPath(page, table, r.id),
  });
  // The recorder of every item is the conversation's recorder.
  const recorder = c.recorded_by === v.userId ? null : await d.selectFrom("users").innerJoin("persons", "persons.id", "users.person_id").select("persons.name").where("users.id", "=", c.recorded_by).executeTakeFirst();
  const by = recorder ? { by: recorder.name } : {};
  const [facts, promises, dates, exchanges, relationships] = await Promise.all([
    d.selectFrom("facts").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "facts")).orderBy("created_at").execute(),
    d.selectFrom("promises").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "promises")).orderBy("created_at").execute(),
    d.selectFrom("dates").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "dates")).orderBy("created_at").execute(),
    d.selectFrom("exchanges").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "exchanges")).orderBy("created_at").execute(),
    d.selectFrom("relationships").selectAll().where("conversation_id", "=", id).$call((qb) => visible(qb, v, "relationships")).orderBy("created_at").execute(),
  ]);
  const ids = [...new Set([...[facts, promises, dates, exchanges].flat().map((x) => x.person_id), ...relationships.flatMap((r) => [r.from_id, r.to_id])])];
  const names = new Map(ids.length ? (await d.selectFrom("persons").select(["id", "name"]).where("id", "in", ids).execute()).map((p) => [p.id, p.name]) : []);
  const about = (personId: string): About => ({ personId, name: names.get(personId) ?? "" });
  return {
    id: c.id,
    date: c.date,
    kind: c.kind as ConversationKind,
    place: c.place_id ? ((await d.selectFrom("places").select("name").where("id", "=", c.place_id).executeTakeFirst())?.name ?? null) : null,
    placeId: c.place_id,
    experienceId: c.experience_id && (await d.selectFrom("experiences").select("id").where("id", "=", c.experience_id).$call((qb) => visible(qb, v, "experiences")).executeTakeFirst()) ? c.experience_id : null,
    summary: c.summary,
    rambleId: c.ramble_id,
    transcript: c.recorded_by === v.userId || !ramble.transcript_private ? ramble.transcript : null,
    visibility: c.visibility as Visibility,
    recordedBy: c.recorded_by,
    url: page,
    participants: participants.map((p) => ({ ...p, url: personPath(p.id) })),
    facts: facts.map((f) => ({ ...item("facts", f), ...about(f.person_id), text: f.text, category: f.category as FactCategory, status: f.status })),
    promises: promises.map((p) => ({ ...item("promises", p), ...about(p.person_id), text: p.text, byMe: !!p.by_me && !recorder, ...(p.by_me ? by : {}), due: p.due, done: !!p.done })),
    dates: dates.map((x) => ({ ...item("dates", x), ...about(x.person_id), kind: x.kind, date: x.date, label: x.label, yearly: !!x.yearly })),
    exchanges: exchanges.map((e) => ({
      ...item("exchanges", e),
      ...about(e.person_id),
      kind: e.kind as ExchangeKind,
      direction: e.direction,
      ...by,
      text: e.text,
      amount: e.amount,
      currency: e.currency,
      settled: !!e.settled,
    })),
    relationships: relationships.map((r) => ({ ...item("relationships", r), fromId: r.from_id, fromName: names.get(r.from_id) ?? "", toId: r.to_id, toName: names.get(r.to_id) ?? "", label: r.label, inverse: r.inverse, note: r.note })),
  };
}
