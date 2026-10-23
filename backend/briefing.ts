// Everything to know before meeting a person, as the viewer sees it: every list below is read through `visible`, and "recent"
// shows who else was there (names are always shared) but never the items of a conversation.
import { db } from "./db";
import { today } from "./dates";
import { upcomingDates, type UpcomingDate } from "./due";
import { freshness, suggestInterval, type Freshness } from "./intervals";
import { getPerson } from "./people";
import type { ExchangeKind, FactCategory, RelationshipType, Viewer, Visibility } from "./types";
import { visible } from "./visibility";

const NEXT_DATES_DAYS = 60;
const RECENT = 5;

/** Whose an item is: `mine` when the viewer recorded it, which is when the page offers edit, visibility and delete. */
type Own = { visibility: Visibility; mine: boolean };

export type Briefing = {
  person: { id: string; name: string; aliases: string[] };
  freshness: Freshness;
  nextDates: UpcomingDate[];
  current: Array<Own & { id: string; text: string; category: FactCategory }>;
  open: {
    promises: Array<Own & { id: string; text: string; byMe: boolean; due: string | null }>;
    exchanges: Array<Own & { id: string; kind: ExchangeKind; direction: "to_them" | "from_them"; text: string; amount: number | null; currency: string | null }>;
    giftIdeas: Array<Own & { id: string; text: string }>;
  };
  recent: Array<{ id: string; date: string; kind: string; summary: string; withOthers: string[] }>;
  /** `direction` is `out` when the person is the `from` side of the relationship (see `RelationshipType`), `in` otherwise. */
  relationships: Array<{ personId: string; name: string; type: RelationshipType; direction: "out" | "in" }>;
  /** Only while the interval isn't confirmed, and only when the history is long enough to suggest one. */
  suggestedInterval?: number;
};

export async function briefing(v: Viewer, personId: string, from = today()): Promise<Briefing> {
  const person = await getPerson(v, personId);
  const d = await db();
  const [fresh, nextDates, facts, promises, exchanges, rels, convs, setting] = await Promise.all([
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
  ]);

  const names = new Map((await d.selectFrom("persons").select(["id", "name"]).execute()).map((p) => [p.id, p.name]));
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

  const own = (r: { visibility: string; recorded_by: string }): Own => ({ visibility: r.visibility as Visibility, mine: r.recorded_by === v.userId });
  const suggested = setting?.interval_confirmed ? null : await suggestInterval(v, personId);
  return {
    person: { id: person.id, name: person.name, aliases: person.aliases },
    freshness: fresh,
    nextDates,
    current: facts.map((f) => ({ id: f.id, text: f.text, category: f.category as FactCategory, ...own(f) })),
    open: {
      promises: promises.map((p) => ({ id: p.id, text: p.text, byMe: !!p.by_me, due: p.due, ...own(p) })),
      exchanges: exchanges
        .filter((e) => e.kind !== "gift_idea")
        .map((e) => ({ id: e.id, kind: e.kind as ExchangeKind, direction: e.direction, text: e.text, amount: e.amount, currency: e.currency, ...own(e) })),
      giftIdeas: exchanges.filter((e) => e.kind === "gift_idea").map((e) => ({ id: e.id, text: e.text, ...own(e) })),
    },
    recent: convs.map((c) => ({ id: c.id, date: c.date, kind: c.kind, summary: c.summary, withOthers: withOthers(c.id) })),
    relationships: rels.map((r) => {
      const out = r.from_id === personId;
      const other = out ? r.to_id : r.from_id;
      return { personId: other, name: names.get(other) ?? "", type: r.type as RelationshipType, direction: out ? "out" : "in" };
    }),
    ...(suggested !== null ? { suggestedInterval: suggested } : {}),
  };
}
