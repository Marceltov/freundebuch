// Everything to know before meeting a person, as the viewer sees it: every list below is read through `visible`, and "recent"
// shows who else was there (names are always shared) but never the items of a conversation.
import { sql } from "kysely";
import { db } from "./db";
import { ageOn, nextOccurrence, today } from "./dates";
import { upcomingDates, type UpcomingDate } from "./due";
import { freshness, suggestInterval, type Freshness } from "./intervals";
import { getPerson } from "./people";
import { labelKey } from "./conversations";
import { householdPersons } from "./household";
import { buildNetwork, type Network } from "./network";
import { FACT_CATEGORIES, type ExchangeKind, type FactCategory, type Gender, type Viewer, type Visibility } from "./types";
import { conversationPath, groupPath, itemPath, personPath } from "./urls";
import { hiddenFiles } from "./files";
import { journalEntries, type JournalEntry } from "./journal";
import { listExperiences, type ExperienceView } from "./experiences";
import { homesOf, type PlaceCandidate } from "./places";
import { splitTraits, toFact, type Traits } from "./traits";
import { visible } from "./visibility";

const NEXT_DATES_DAYS = 60;
const RECENT = 5;
/** How many of the viewer's journal entries about the person a briefing shows. */
const BRIEFING_JOURNAL = 5;

/** Whose an item is: `mine` when the viewer recorded it, which is when the page offers edit, visibility and delete. */
type Own = { visibility: Visibility; mine: boolean };

/** A birthday as recorded (`date`, `--MM-DD` without a year), the day it falls on next, and the age reached then when the year is known. */
export type Birthday = { id: string; date: string; next: string; age: number | null };

/** `source`, `happenedOn` and `imageUrl` for a fact filed from a shared file: where it was posted, when it happened (when
 * known), and the file. */
export type Fact = Own & { id: string; text: string; category: FactCategory; url: string; source?: string; happenedOn?: string; imageUrl?: string };

/**
 * Who the person is to the household, read from the viewer's side: `label` what they are, in the words filed ("Vermieterin");
 * `with` is `us` when the viewer sees the relationship to every household person, `me` when only to their own person, `partner`
 * when only to the other user's (`partnerName`). `ids` are the relationships it stands for.
 */
export type Role = { label: string; with: "me" | "partner" | "us"; partnerName?: string; ids: string[] };

export type Briefing = {
  /** `birthday` however far away it is; the viewer's own record of it wins over the partner's shared one. */
  person: { id: string; name: string; aliases: string[]; url: string; birthday: Birthday | null; gender: Gender | null };
  /** Who the person is to us: the first thing to say about them ("your landlady"). */
  roles: Role[];
  /** The groups the viewer may see the person in, each once. `private`: the viewer's own private membership is the only one they see. */
  groups: Array<{ id: string; name: string; url: string; private: boolean }>;
  freshness: Freshness;
  nextDates: UpcomingDate[];
  /** What is going on and will end, the ones to ask about first: `since` the day the latest news was filed, `nudge` once
   * `checkAfter` has come. */
  situations: Array<Fact & { since: string; checkAfter: string; nudge: boolean }>;
  /** What the person needs (plan around it) and how they are, each as filed. */
  traits: Traits;
  /** What else stays true, by category, then as filed. */
  known: Fact[];
  /** The viewer's own journal entries that name the person, the last few, newest first. Never the other user's. */
  journal: JournalEntry[];
  /** The experiences the viewer may see that the person was at, the last few, newest first. */
  experiences: ExperienceView[];
  /** Where the person lives: the places the viewer may see are their home. */
  homes: PlaceCandidate[];
  open: {
    /** `byMe`: the viewer made the promise. `by`: the other user's name, when they made it (they recorded it); neither: the person made it. */
    promises: Array<Own & { id: string; text: string; byMe: boolean; by?: string; due: string | null; url: string }>;
    /** `by`: the other user's name, when they recorded it; `direction` then reads from their side (`to_them`: they gave). */
    exchanges: Array<Own & { id: string; kind: ExchangeKind; direction: "to_them" | "from_them"; by?: string; text: string; amount: number | null; currency: string | null; url: string }>;
    giftIdeas: Array<Own & { id: string; text: string; url: string }>;
  };
  recent: Array<{ id: string; date: string; kind: string; summary: string; withOthers: string[]; url: string }>;
  /** Every visible relationship of the person, roles included, as stored: `label` is what `from` is to `to`, `inverse` what `to` is
   * to `from`. `direction` is `out` when the person is `from`, `in` when they are `to`; `personId` and `name` are the other end's. */
  relationships: Array<Own & { id: string; personId: string; name: string; label: string; inverse: string; note: string | null; direction: "out" | "in"; url: string }>;
  /** One hop: the person, the household persons with a visible relationship to them, then their other people. */
  network: Network;
  /** Only while the interval isn't confirmed, only when the history is long enough to suggest one, and never for a household person. */
  suggestedInterval?: number;
};

export async function briefing(v: Viewer, personId: string, from = today()): Promise<Briefing> {
  const person = await getPerson(v, personId);
  const d = await db();
  const [fresh, nextDates, facts, promises, exchanges, rels, convs, setting, birthdays, groups] = await Promise.all([
    freshness(v, personId, from),
    upcomingDates(v, from, NEXT_DATES_DAYS, personId),
    d.selectFrom("facts").selectAll().where("person_id", "=", personId).where("status", "=", "current").$call((qb) => visible(qb, v, "facts")).orderBy("created_at").execute(),
    d.selectFrom("promises").selectAll().where("person_id", "=", personId).where("done", "=", 0).$call((qb) => visible(qb, v, "promises")).orderBy("created_at").execute(),
    d.selectFrom("exchanges").selectAll().where("person_id", "=", personId).where("settled", "=", 0).$call((qb) => visible(qb, v, "exchanges")).orderBy("created_at").execute(),
    d
      .selectFrom("relationships")
      .selectAll()
      .where((eb) => eb.or([eb("from_id", "=", personId), eb("to_id", "=", personId)]))
      .$call((qb) => visible(qb, v, "relationships"))
      .orderBy("created_at")
      .orderBy(sql`rowid`)
      .execute(),
    d
      .selectFrom("conversations")
      .innerJoin("participants", "participants.conversation_id", "conversations.id")
      .select(["conversations.id", "conversations.date", "conversations.kind", "conversations.summary"])
      .where("participants.person_id", "=", personId)
      .$call((qb) => visible(qb, v, "conversations"))
      .orderBy("conversations.date", "desc")
      .orderBy("conversations.created_at", "desc")
      .limit(RECENT)
      .execute(),
    d.selectFrom("person_settings").select("interval_confirmed").where("user_id", "=", v.userId).where("person_id", "=", personId).executeTakeFirst(),
    d.selectFrom("dates").select(["id", "date", "yearly", "recorded_by"]).where("person_id", "=", personId).where("kind", "=", "birthday").$call((qb) => visible(qb, v, "dates")).orderBy("created_at").execute(),
    d
      .selectFrom("group_members")
      .innerJoin("groups", "groups.id", "group_members.group_id")
      .select(["groups.id", "groups.name", "group_members.visibility"])
      .where("group_members.person_id", "=", personId)
      .$call((qb) => visible(qb, v, "group_members"))
      .orderBy("groups.name")
      .execute(),
  ]);

  const persons = await d.selectFrom("persons").select(["id", "name", "gender"]).execute();
  const names = new Map(persons.map((p) => [p.id, p.name]));
  const household = await householdPersons(d);
  // Promises and exchanges are stored from their recorder's side; one the other user recorded is shown with their own person's name.
  const users = new Map((await d.selectFrom("users").select(["id", "person_id"]).execute()).map((u) => [u.id, (u.person_id && names.get(u.person_id)) || ""]));
  const by = (r: { recorded_by: string }) => (r.recorded_by === v.userId ? {} : { by: users.get(r.recorded_by) ?? "" });
  const others = convs.length
    ? await d
        .selectFrom("participants")
        .select(["conversation_id", "person_id"])
        .where("conversation_id", "in", convs.map((c) => c.id))
        .where("person_id", "not in", [personId, v.personId])
        .execute()
    : [];
  const withOthers = (id: string) =>
    others
      .filter((o) => o.conversation_id === id)
      .map((o) => names.get(o.person_id) ?? "")
      .sort((a, b) => a.localeCompare(b));

  const page = personPath(personId);
  const own = (r: { visibility: string; recorded_by: string }): Own => ({ visibility: r.visibility as Visibility, mine: r.recorded_by === v.userId });
  // One of us needs no check-in interval: you see each other every day.
  const suggested = setting?.interval_confirmed || household.includes(personId) ? null : await suggestInterval(v, personId);
  const bday = birthdays.find((x) => x.recorded_by === v.userId) ?? birthdays[0];
  const next = bday && (bday.yearly ? nextOccurrence(bday.date, from) : bday.date);
  const hidden = await hiddenFiles(v, facts.flatMap((f) => (f.file_id ? [f.file_id] : [])));
  const fact = (f: (typeof facts)[number]): Fact => toFact(f, v, page, hidden);
  const situations = facts
    .filter((f) => f.kind === "situation")
    .map((f) => ({ ...fact(f), since: today(f.created_at), checkAfter: f.check_after!, nudge: f.check_after! <= from }))
    .sort((x, y) => Number(y.nudge) - Number(x.nudge));
  const known = facts
    .filter((f) => f.kind === "lasting")
    .sort((x, y) => FACT_CATEGORIES.indexOf(x.category as FactCategory) - FACT_CATEGORIES.indexOf(y.category as FactCategory) || x.created_at - y.created_at)
    .map(fact);
  return {
    person: {
      id: person.id,
      name: person.name,
      aliases: person.aliases,
      url: page,
      birthday: bday ? { id: bday.id, date: bday.date, next, age: ageOn(bday.date, next) } : null,
      gender: person.gender,
    },
    roles: roles(v, personId, rels, household, names),
    groups: [...new Map(groups.map((g) => [g.id, g])).values()].map((g) => ({ id: g.id, name: g.name, url: groupPath(g.id), private: groups.every((x) => x.id !== g.id || x.visibility === "private") })),
    freshness: fresh,
    nextDates,
    situations,
    traits: splitTraits(facts, v, page, hidden),
    journal: await journalEntries(v, { from: "0000-01-01", to: from, personId, own: true, limit: BRIEFING_JOURNAL }),
    experiences: await listExperiences(v, { personId, to: from, limit: BRIEFING_JOURNAL }),
    homes: await homesOf(v, personId),
    known,
    open: {
      promises: promises.map((p) => ({ id: p.id, text: p.text, byMe: !!p.by_me && p.recorded_by === v.userId, ...(p.by_me ? by(p) : {}), due: p.due, url: itemPath(page, "promises", p.id), ...own(p) })),
      exchanges: exchanges
        .filter((e) => e.kind !== "gift_idea")
        .map((e) => ({ id: e.id, kind: e.kind as ExchangeKind, direction: e.direction, ...by(e), text: e.text, amount: e.amount, currency: e.currency, url: itemPath(page, "exchanges", e.id), ...own(e) })),
      giftIdeas: exchanges.filter((e) => e.kind === "gift_idea").map((e) => ({ id: e.id, text: e.text, url: itemPath(page, "exchanges", e.id), ...own(e) })),
    },
    recent: convs.map((c) => ({ id: c.id, date: c.date, kind: c.kind, summary: c.summary, withOthers: withOthers(c.id), url: conversationPath(c.id) })),
    relationships: rels.map((r) => {
      const out = r.from_id === personId;
      const other = out ? r.to_id : r.from_id;
      return { id: r.id, personId: other, name: names.get(other) ?? "", label: r.label, inverse: r.inverse, note: r.note, direction: out ? "out" : "in", url: personPath(other), ...own(r) };
    }),
    network: buildNetwork(personId, rels, household, names, new Map(persons.map((p) => [p.id, p.gender]))),
    ...(suggested !== null ? { suggestedInterval: suggested } : {}),
  };
}

/**
 * The person's visible relationships to household persons, one role per relationship however many of us it runs to: "Vermieterin
 * of Alice" and "Vermieter:in of Bob" are one role, keyed by both ends' words without their gender endings.
 */
function roles(v: Viewer, personId: string, rels: { id: string; from_id: string; to_id: string; label: string; inverse: string }[], household: string[], names: Map<string, string>): Role[] {
  const ours = household.filter((h) => h !== personId);
  const groups = new Map<string, { label: string; ids: string[]; with: Set<string> }>();
  for (const r of rels) {
    const out = r.from_id === personId;
    const other = out ? r.to_id : r.from_id;
    if (!ours.includes(other)) continue;
    const [theirs, ourWord] = out ? [r.label, r.inverse] : [r.inverse, r.label];
    const key = `${labelKey(theirs)}:${labelKey(ourWord)}`;
    const g = groups.get(key) ?? { label: theirs, ids: [], with: new Set<string>() };
    g.ids.push(r.id);
    g.with.add(other);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const partner = [...g.with].find((h) => h !== v.personId);
    const w = ours.every((h) => g.with.has(h)) && (ours.length > 1 || g.with.has(v.personId)) ? (ours.length > 1 ? "us" : "me") : g.with.has(v.personId) ? "me" : "partner";
    return { label: g.label, with: w, ...(w === "partner" ? { partnerName: names.get(partner!) ?? "" } : {}), ids: g.ids };
  });
}
