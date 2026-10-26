// Everything to know before meeting a person, as the viewer sees it: every list below is read through `visible`, and "recent"
// shows who else was there (names are always shared) but never the items of a conversation.
import { db } from "./db";
import { ageOn, nextOccurrence, today } from "./dates";
import { upcomingDates, type UpcomingDate } from "./due";
import { freshness, suggestInterval, type Freshness } from "./intervals";
import { getPerson } from "./people";
import type { ExchangeKind, FactCategory, RelationshipType, Viewer, Visibility } from "./types";
import { conversationPath, groupPath, itemPath, personPath, screenshotPath } from "./urls";
import { visible } from "./visibility";

const NEXT_DATES_DAYS = 60;
const RECENT = 5;

/** Whose an item is: `mine` when the viewer recorded it, which is when the page offers edit, visibility and delete. */
type Own = { visibility: Visibility; mine: boolean };

/** A birthday as recorded (`date`, `--MM-DD` without a year), the day it falls on next, and the age reached then when the year is known. */
export type Birthday = { id: string; date: string; next: string; age: number | null };

export type Briefing = {
  /** `birthday` however far away it is; the viewer's own record of it wins over the partner's shared one. */
  person: { id: string; name: string; aliases: string[]; url: string; birthday: Birthday | null };
  /** The groups the viewer may see the person in, each once. `private`: the viewer's own private membership is the only one they see. */
  groups: Array<{ id: string; name: string; url: string; private: boolean }>;
  freshness: Freshness;
  nextDates: UpcomingDate[];
  /** `source`, `happenedOn` and `imageUrl` for a fact read from a shared screenshot: where it was posted, when it happened
   * (when known), and the screenshot. */
  current: Array<Own & { id: string; text: string; category: FactCategory; url: string; source?: string; happenedOn?: string; imageUrl?: string }>;
  open: {
    /** `byMe`: the viewer made the promise. `by`: the other user's name, when they made it (they recorded it); neither: the person made it. */
    promises: Array<Own & { id: string; text: string; byMe: boolean; by?: string; due: string | null; url: string }>;
    /** `by`: the other user's name, when they recorded it; `direction` then reads from their side (`to_them`: they gave). */
    exchanges: Array<Own & { id: string; kind: ExchangeKind; direction: "to_them" | "from_them"; by?: string; text: string; amount: number | null; currency: string | null; url: string }>;
    giftIdeas: Array<Own & { id: string; text: string; url: string }>;
  };
  recent: Array<{ id: string; date: string; kind: string; summary: string; withOthers: string[]; url: string }>;
  /** `direction` is `out` when the person is the `from` side of the relationship (see `RelationshipType`), `in` otherwise. */
  relationships: Array<Own & { id: string; personId: string; name: string; type: RelationshipType; note: string | null; direction: "out" | "in"; url: string }>;
  /** Only while the interval isn't confirmed, and only when the history is long enough to suggest one. */
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

  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
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
  const suggested = setting?.interval_confirmed ? null : await suggestInterval(v, personId);
  const bday = birthdays.find((x) => x.recorded_by === v.userId) ?? birthdays[0];
  const next = bday && (bday.yearly ? nextOccurrence(bday.date, from) : bday.date);
  return {
    person: { id: person.id, name: person.name, aliases: person.aliases, url: page, birthday: bday ? { id: bday.id, date: bday.date, next, age: ageOn(bday.date, next) } : null },
    groups: [...new Map(groups.map((g) => [g.id, g])).values()].map((g) => ({ id: g.id, name: g.name, url: groupPath(g.id), private: groups.every((x) => x.id !== g.id || x.visibility === "private") })),
    freshness: fresh,
    nextDates,
    current: facts.map((f) => ({
      id: f.id,
      text: f.text,
      category: f.category as FactCategory,
      url: itemPath(page, "facts", f.id),
      ...(f.source ? { source: f.source } : {}),
      ...(f.happened_on ? { happenedOn: f.happened_on } : {}),
      ...(f.screenshot_id ? { imageUrl: screenshotPath(f.screenshot_id) } : {}),
      ...own(f),
    })),
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
      return { id: r.id, personId: other, name: names.get(other) ?? "", type: r.type as RelationshipType, note: r.note, direction: out ? "out" : "in", url: personPath(other), ...own(r) };
    }),
    ...(suggested !== null ? { suggestedInterval: suggested } : {}),
  };
}
