// Finding what was told by a word the user remembers ("Spiegel", "Hellengerst"), not by who or when. Every source is read through
// the same readers as everywhere else, so only what the viewer may see can match: the partner's private items never do, not even
// as a count, and a transcript only when the viewer may read it (V2). Plain matching on folded words, every word must occur;
// not meaning search.
import { db } from "./db";
import { InvalidInputError } from "./errors";
import { listPlaces } from "./places";
import { norm } from "./names";
import { listRambles } from "./rambles";
import { today } from "./dates";
import type { SearchKind, Viewer } from "./types";
import { itemPath, personPath, ramblePath } from "./urls";
import { visible } from "./visibility";

/**
 * One match. `text` is the matching text, cut around the first match when it is long; `date` the day it was told or happened
 * (null for a place); `rambleId` the ramble it was told in, when there is one.
 */
export type SearchHit = { kind: SearchKind; id: string; date: string | null; text: string; people: string[]; url: string; rambleId: string | null };

const MAX_LIMIT = 50;
const SNIPPET = 160;

/** The query's words, folded; empty words dropped. */
export function searchWords(query: string): string[] {
  return [...new Set(query.split(/\s+/).map(norm).filter(Boolean))];
}

/** Whether every word occurs in one of the texts. */
const matches = (words: string[], ...texts: Array<string | null | undefined>) => {
  const hay = norm(texts.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
};

/** `text`, cut to about SNIPPET characters around the first word that occurs in it, with "…" where it was cut. */
export function snippet(text: string, words: string[]): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET) return flat;
  // Folding keeps the length of most text; when it doesn't, the cut lands near the match instead of on it.
  const folded = norm(flat);
  const at = Math.max(0, Math.min(...words.map((w) => folded.indexOf(w)).filter((i) => i >= 0), flat.length));
  const start = Math.max(0, Math.min(at - SNIPPET / 3, flat.length - SNIPPET));
  const from = start ? flat.indexOf(" ", start) + 1 || start : 0;
  const to = Math.min(flat.length, from + SNIPPET);
  const end = to < flat.length ? flat.lastIndexOf(" ", to) : to;
  return `${from ? "…" : ""}${flat.slice(from, end > from ? end : to)}${end < flat.length ? "…" : ""}`;
}

/** What the viewer may see that holds every word of `query`, newest first, at most `limit` (20 by default, 50 at most). */
export async function search(v: Viewer, query: string, limit = 20): Promise<SearchHit[]> {
  const words = searchWords(query);
  if (!words.length) throw new InvalidInputError("Give a word to search for");
  if (!Number.isInteger(limit) || limit < 1) throw new InvalidInputError("limit must be a positive whole number");
  const d = await db();
  const hits: SearchHit[] = [];

  // Rambles the viewer may see a part of, and what was told in them.
  const rambles = await listRambles(v);
  const readable = rambles.length
    ? await d
        .selectFrom("rambles")
        .select(["id", "transcript"])
        .where(
          "id",
          "in",
          rambles.map((r) => r.id),
        )
        .where((eb) => eb.or([eb("recorded_by", "=", v.userId), eb("transcript_private", "=", 0)]))
        .execute()
    : [];
  const transcripts = new Map(readable.map((r) => [r.id, r.transcript]));
  for (const r of rambles) {
    const people = [
      ...new Set([
        ...r.conversations.flatMap((c) => c.people.map((p) => p.name)),
        ...r.experiences.flatMap((e) => e.people.map((p) => p.name)),
        ...r.journal.flatMap((j) => j.people.map((p) => p.name)),
      ]),
    ];
    const transcript = transcripts.get(r.id);
    if (transcript && matches(words, transcript))
      hits.push({ kind: "transcript", id: r.id, date: r.date, text: snippet(transcript, words), people, url: ramblePath(r.id), rambleId: r.id });
    for (const c of r.conversations)
      if (matches(words, c.summary, ...c.people.map((p) => p.name)))
        hits.push({
          kind: "conversation",
          id: c.id,
          date: c.date,
          text: snippet(c.summary, words),
          people: c.people.map((p) => p.name),
          url: c.url,
          rambleId: r.id,
        });
    for (const e of r.experiences)
      if (matches(words, e.title, e.kind, e.summary, e.place?.name, e.series?.name, ...e.people.map((p) => p.name)))
        hits.push({
          kind: "experience",
          id: e.id,
          date: e.date,
          text: snippet([e.title, e.summary].filter(Boolean).join(": "), words),
          people: e.people.map((p) => p.name),
          url: e.url,
          rambleId: r.id,
        });
    for (const j of r.journal)
      if (matches(words, j.text, ...j.people.map((p) => p.name)))
        hits.push({ kind: "journal", id: j.id, date: j.date, text: snippet(j.text, words), people: j.people.map((p) => p.name), url: j.url, rambleId: r.id });
  }

  // Items about a person, filed in a conversation, with a ramble alone, or remembered without one.
  const items = async <T extends "facts" | "promises" | "exchanges" | "dates">(table: T) =>
    (await d
      .selectFrom(table as "facts")
      .innerJoin("persons", "persons.id", `${table as "facts"}.person_id`)
      .select([
        `${table as "facts"}.id as id`,
        `${table as "facts"}.ramble_id as rambleId`,
        `${table as "facts"}.created_at as createdAt`,
        "persons.id as personId",
        "persons.name as name",
      ])
      .$if(table === "dates", (qb) => qb.select((eb) => eb.fn.coalesce(eb.ref("dates.label" as "facts.text"), eb.val("")).as("text")))
      .$if(table !== "dates", (qb) => qb.select(`${table as "facts"}.text as text`))
      .$call((qb) => visible(qb, v, table as "facts"))
      .execute()) as Array<{ id: string; rambleId: string | null; createdAt: number; personId: string; name: string; text: string }>;
  const KIND = { facts: "fact", promises: "promise", exchanges: "exchange", dates: "date" } as const;
  const rambleDays = new Map(rambles.map((r) => [r.id, r.date]));
  for (const table of ["facts", "promises", "exchanges", "dates"] as const)
    for (const i of await items(table))
      if (i.text && matches(words, i.text, i.name))
        hits.push({
          kind: KIND[table],
          id: i.id,
          date: (i.rambleId && rambleDays.get(i.rambleId)) || today(i.createdAt),
          text: snippet(i.text, words),
          people: [i.name],
          url: itemPath(personPath(i.personId), table, i.id),
          rambleId: i.rambleId,
        });

  for (const p of await listPlaces(v))
    if (matches(words, p.name, p.address, ...p.aliases))
      hits.push({
        kind: "place",
        id: p.id,
        date: null,
        text: [p.name, p.address].filter(Boolean).join(", "),
        people: p.owners.map((o) => o.name),
        url: p.url,
        rambleId: null,
      });

  return hits.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? "")).slice(0, Math.min(limit, MAX_LIMIT));
}

/** `text` in pieces, `mark` on each word that holds one of the query's words, for showing a hit with its matches marked. */
export function markMatches(text: string, query: string): Array<{ text: string; mark: boolean }> {
  const words = searchWords(query);
  const out: Array<{ text: string; mark: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}'’]+/gu)) {
    const folded = norm(m[0]);
    if (!words.some((w) => folded.includes(w))) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), mark: false });
    out.push({ text: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mark: false });
  return out;
}
