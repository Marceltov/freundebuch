// Moving people into another of the mover's books (spec "Moving"). What moves is what the mover may see: the people, their shared
// items and the mover's own private ones, their memberships and the relationships whose other end comes along. A conversation, an
// experience or a journal entry moves when everyone in it other than the book's members moves too. Everything is copied into the
// target with new ids, then deleted from the source unless something there still points at it: another member's private fact
// keeps a remaining entry for its person, a fact about the mover from a moving conversation keeps that conversation. Nothing is
// deleted behind another member's back, and nothing of theirs that they keep private lands in a book they aren't in.
import { instance, type Scope } from "../db/scope";
import { newId } from "../db";
import { REFS, type BookTable } from "../db/tables";
import { visible, visibleGroups } from "../visibility";
import { InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { personPath } from "../core/urls";
import { bookRef, inBook, inBookOf, type BookRef } from "./books";
import { memberPersons } from "./household";
import { norm } from "./names";

export type Moved = {
  book: BookRef;
  people: { from: string; id: string; name: string; url: string; remains: boolean }[];
  /** Rows copied into the book, by table. */
  moved: Record<string, number>;
  /** Rows about the people the mover may see that stayed in the source book, by table. */
  stayed: Record<string, number>;
};

const ITEM_TABLES = ["facts", "promises", "dates", "exchanges"] as const;
// What keeps a person in the source book: anything filed about them. Their other names, settings and card follow the person.
const FOLLOWS_PERSON = new Set<string>(["aliases", "person_settings", "card_subscriptions"]);

/** Moves people (by id, or a group's members) into the book `to`, in one transaction. */
export async function movePeople(v: Viewer, people: string[] | { group: string }, to: string): Promise<Moved> {
  const dst = await inBook(v, to);
  const ids = Array.isArray(people) ? [...new Set(people)] : await membersOf(v, people.group, dst.bookId);
  if (!ids.length) throw new InvalidInputError("Name at least one person to move");
  const src = await inBookOf(v, ids);
  if (!src) throw new InvalidInputError("Name at least one person to move");
  if (src.bookId === dst.bookId) throw new InvalidInputError("They are in that book already");
  const result = await (await instance()).transaction(async (i) => move(i.scope(src), i.scope(dst), ids));
  return { book: await bookRef(dst.bookId), ...result };
}

/** The people in a group the viewer sees, in the one book (not `except`) that has a group of that name. */
async function membersOf(v: Viewer, group: string, except: string): Promise<string[]> {
  const found: string[][] = [];
  for (const b of v.books.filter((x) => x !== except)) {
    const s = (await instance()).scope(await inBook(v, b));
    const groups = await visibleGroups(s.from("groups").select(["id", "name"]), s.v).execute();
    const aliases = await s.from("group_aliases").select(["group_id", "norm"]).execute();
    const g = groups.find((x) => norm(x.name) === norm(group) || aliases.some((a) => a.group_id === x.id && a.norm === norm(group)));
    if (!g) continue;
    const rows = await visible(s.from("group_members").select("person_id").where("group_id", "=", g.id), s.v, "group_members").execute();
    found.push([...new Set(rows.map((r) => r.person_id))]);
  }
  if (!found.length) throw new NotFoundError(`No group called ${group}`);
  if (found.length > 1) throw new InvalidInputError(`More than one book has a group called ${group}: name the people instead`);
  return found[0];
}

const unbooked = <T extends { book_id: string }>(row: T): Omit<T, "book_id"> => {
  const { book_id, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

async function move(from: Scope, into: Scope, ids: string[]): Promise<Omit<Moved, "book">> {
  const v = from.v;
  const moved: Record<string, number> = {};
  const count = (table: string, n = 1) => n && (moved[table] = (moved[table] ?? 0) + n);
  const map = new Map<string, string>(); // source id → its copy

  const srcMembers = await memberPersons(from);
  const dstMembers = await memberPersons(into);
  const memberPerson = new Map([...srcMembers].flatMap(([user, person]) => (dstMembers.has(user) ? [[person, dstMembers.get(user)!]] : [])));
  const isMember = new Set(srcMembers.values());
  if (ids.some((id) => isMember.has(id))) throw new InvalidInputError("A member of the book can't be moved; move the people they know");
  const moving = new Set(ids);
  // The person a row's person becomes in the target: a moving person's copy, or a member's own person there.
  const personThere = (id: string) => map.get(id) ?? memberPerson.get(id);

  // ---- the people ----------------------------------------------------------------------------------------------------------
  const persons = await from.from("persons").selectAll().where("id", "in", ids).execute();
  if (persons.length !== ids.length) throw new NotFoundError("No such person");
  for (const p of persons) {
    map.set(p.id, newId());
    await into.insert("persons", { ...unbooked(p), id: map.get(p.id)!, created_from: null }).execute();
    count("persons");
  }
  for (const a of await from.from("aliases").selectAll().where("person_id", "in", ids).execute())
    await into.insert("aliases", { ...unbooked(a), person_id: map.get(a.person_id)! }).execute();
  const dstUsers = new Set(dstMembers.keys());
  for (const x of await from.from("person_settings").selectAll().where("person_id", "in", ids).execute())
    if (dstUsers.has(x.user_id)) await into.insert("person_settings", { ...unbooked(x), person_id: map.get(x.person_id)! }).execute();
  for (const c of await from.from("card_subscriptions").selectAll().where("person_id", "in", ids).execute())
    await into.insert("card_subscriptions", { ...unbooked(c), person_id: map.get(c.person_id)! }).execute();

  // ---- what they come with: places, series and transcripts, matched or copied once ----------------------------------------
  const places = new Map<string, Promise<string>>();
  const placeThere = (id: string | null): Promise<string | null> => {
    if (!id) return Promise.resolve(null);
    if (!places.has(id))
      places.set(
        id,
        (async () => {
          const p = await from.from("places").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
          const named = await into.from("places").select(["id", "name"]).execute();
          const aliases = await into.from("place_aliases").select(["place_id", "norm"]).where("norm", "=", norm(p.name)).execute();
          const same = named.find((x) => norm(x.name) === norm(p.name))?.id ?? aliases[0]?.place_id;
          if (same) return same;
          const copy = newId();
          await into.insert("places", { ...unbooked(p), id: copy, parent_id: await placeThere(p.parent_id) }).execute();
          count("places");
          return copy;
        })(),
      );
    return places.get(id)!;
  };
  const series = new Map<string, Promise<string>>();
  const seriesThere = (id: string | null): Promise<string | null> => {
    if (!id) return Promise.resolve(null);
    if (!series.has(id))
      series.set(
        id,
        (async () => {
          const x = await from.from("series").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
          const same = (await into.from("series").select(["id", "name"]).execute()).find((y) => norm(y.name) === norm(x.name));
          if (same) return same.id;
          const copy = newId();
          await into.insert("series", { ...unbooked(x), id: copy, place_id: await placeThere(x.place_id) }).execute();
          count("series");
          return copy;
        })(),
      );
    return series.get(id)!;
  };
  // Whether everyone in it other than the members moves too, so it can come along.
  const comesAlong = (people: string[]) => people.every((p) => moving.has(p) || isMember.has(p));
  const peopleIn = async (
    table: "experience_people" | "participants" | "journal_mentions",
    column: "experience_id" | "conversation_id" | "entry_id",
    id: string,
  ) =>
    (
      (await from
        .from(table)
        .select("person_id")
        .where(column as never, "=", id as never)
        .execute()) as { person_id: string }[]
    ).map((r) => r.person_id);

  // ---- what would move ----------------------------------------------------------------------------------------------------
  const expIds = (await from.from("experience_people").select("experience_id").where("person_id", "in", ids).execute()).map((r) => r.experience_id);
  let experiences = [];
  for (const e of expIds.length ? await visible(from.from("experiences").selectAll().where("id", "in", expIds), v, "experiences").execute() : []) {
    const people = await peopleIn("experience_people", "experience_id", e.id);
    if (comesAlong(people)) experiences.push({ row: e, people });
  }
  const convIds = (await from.from("participants").select("conversation_id").where("person_id", "in", ids).execute()).map((r) => r.conversation_id);
  let conversations = [];
  for (const c of convIds.length ? await visible(from.from("conversations").selectAll().where("id", "in", convIds), v, "conversations").execute() : []) {
    const people = await peopleIn("participants", "conversation_id", c.id);
    if (comesAlong(people)) conversations.push({ row: c, people });
  }
  const entryIds = (await from.from("journal_mentions").select("entry_id").where("person_id", "in", ids).execute()).map((r) => r.entry_id);
  let entries = [];
  for (const j of entryIds.length ? await visible(from.from("journal_entries").selectAll().where("id", "in", entryIds), v, "journal_entries").execute() : []) {
    const people = await peopleIn("journal_mentions", "entry_id", j.id);
    if (comesAlong(people)) entries.push({ row: j, people });
  }
  const items = {
    facts: await visible(from.from("facts").selectAll().where("person_id", "in", ids), v, "facts").execute(),
    promises: await visible(from.from("promises").selectAll().where("person_id", "in", ids), v, "promises").execute(),
    dates: await visible(from.from("dates").selectAll().where("person_id", "in", ids), v, "dates").execute(),
    exchanges: await visible(from.from("exchanges").selectAll().where("person_id", "in", ids), v, "exchanges").execute(),
  };
  const rels = (
    await visible(
      from
        .from("relationships")
        .selectAll()
        .where((eb) => eb.or([eb("from_id", "in", ids), eb("to_id", "in", ids)])),
      v,
      "relationships",
    ).execute()
  ).filter((r) => personThere(r.from_id) && personThere(r.to_id));
  const memberships = await visible(from.from("group_members").selectAll().where("person_id", "in", ids), v, "group_members").execute();
  const homes = await visible(from.from("place_owners").selectAll().where("person_id", "in", ids), v, "place_owners").execute();

  // ---- which transcripts move ---------------------------------------------------------------------------------------------
  // A transcript moves only when everything filed from it moves too, so nothing it tells of people who stay reaches the other
  // book. What moves without its transcript loses the link to it, as it loses a conversation that stays; a conversation, an
  // experience or a journal entry can't be without one, so it stays.
  const keyed = new Set<string>([
    ...[...experiences, ...conversations, ...entries].map((x) => x.row.id),
    ...Object.values(items).flatMap((rows) => rows.map((r) => r.id)),
    ...rels.map((r) => r.id),
  ]);
  const seen = (r: { visibility: string; recorded_by: string }) => r.visibility === "shared" || r.recorded_by === v.userId;
  const movesToo = (r: Record<string, unknown>) =>
    typeof r.id === "string" ? keyed.has(r.id) : moving.has(r.person_id as string) && seen(r as { visibility: string; recorded_by: string });
  const holders = Object.entries(REFS).flatMap(([t, cols]) =>
    Object.entries(cols as Record<string, string>).flatMap(([col, target]) => (target === "rambles" ? [[t as BookTable, col] as const] : [])),
  );
  const candidates = new Set(
    [
      ...[...experiences, ...conversations, ...entries].map((x) => x.row.ramble_id),
      ...Object.values(items).flatMap((rows) => rows.map((r) => r.ramble_id)),
      ...rels.map((r) => r.ramble_id),
      ...memberships.map((m) => m.ramble_id),
      ...homes.map((h) => h.ramble_id),
    ].filter((r): r is string => !!r),
  );
  const movable = new Set<string>();
  for (const r of candidates) {
    if (!(await visible(from.from("rambles").select("id").where("id", "=", r), v, "rambles").executeTakeFirst())) continue;
    let all = true;
    for (const [t, col] of holders) {
      const rows = (await from
        .from(t)
        .selectAll()
        .where(col as never, "=", r as never)
        .execute()) as Record<string, unknown>[];
      if (!rows.every(movesToo)) {
        all = false;
        break;
      }
    }
    if (all) movable.add(r);
  }
  experiences = experiences.filter((x) => movable.has(x.row.ramble_id));
  conversations = conversations.filter((x) => movable.has(x.row.ramble_id));
  entries = entries.filter((x) => movable.has(x.row.ramble_id));

  const rambles = new Map<string, Promise<string | null>>();
  const rambleThere = (id: string | null): Promise<string | null> => {
    if (!id || !movable.has(id)) return Promise.resolve(null);
    if (!rambles.has(id))
      rambles.set(
        id,
        (async () => {
          const r = await from.from("rambles").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
          const copy = newId();
          map.set(id, copy);
          await into.insert("rambles", { ...unbooked(r), id: copy }).execute();
          count("rambles");
          return copy;
        })(),
      );
    return rambles.get(id)!;
  };

  // ---- experiences, conversations and journal entries that come along -----------------------------------------------------
  for (const { row: e, people } of experiences) {
    map.set(e.id, newId());
    await into
      .insert("experiences", {
        ...unbooked(e),
        id: map.get(e.id)!,
        ramble_id: (await rambleThere(e.ramble_id))!,
        series_id: await seriesThere(e.series_id),
        place_id: await placeThere(e.place_id),
      })
      .execute();
    for (const p of people.flatMap((x) => personThere(x) ?? []))
      await into.insert("experience_people", { experience_id: map.get(e.id)!, person_id: p }).execute();
    count("experiences");
  }
  for (const { row: c, people } of conversations) {
    map.set(c.id, newId());
    await into
      .insert("conversations", {
        ...unbooked(c),
        id: map.get(c.id)!,
        ramble_id: (await rambleThere(c.ramble_id))!,
        place_id: await placeThere(c.place_id),
        experience_id: c.experience_id ? (map.get(c.experience_id) ?? null) : null,
      })
      .execute();
    for (const p of people.flatMap((x) => personThere(x) ?? [])) await into.insert("participants", { conversation_id: map.get(c.id)!, person_id: p }).execute();
    count("conversations");
  }
  for (const { row: j, people } of entries) {
    map.set(j.id, newId());
    await into.insert("journal_entries", { ...unbooked(j), id: map.get(j.id)!, ramble_id: (await rambleThere(j.ramble_id))! }).execute();
    for (const p of people.flatMap((x) => personThere(x) ?? [])) await into.insert("journal_mentions", { entry_id: map.get(j.id)!, person_id: p }).execute();
    count("journal_entries");
  }
  const movedExperiences = experiences.map((x) => x.row.id);
  const movedConversations = conversations.map((x) => x.row.id);
  const movedEntries = entries.map((x) => x.row.id);

  // ---- items, relationships, memberships, homes ---------------------------------------------------------------------------
  const links = async (r: { conversation_id: string | null; ramble_id: string | null }) => ({
    conversation_id: r.conversation_id ? (map.get(r.conversation_id) ?? null) : null,
    ramble_id: await rambleThere(r.ramble_id),
  });
  const movedItems: Record<string, string[]> = {};
  for (const table of ITEM_TABLES) {
    const rows = items[table];
    for (const r of rows) {
      map.set(r.id, newId());
      const row = { ...unbooked(r), id: map.get(r.id)!, person_id: map.get(r.person_id)!, ...(await links(r)) };
      await into.insert(table, (table === "facts" ? { ...row, file_id: null, superseded_by: null } : row) as never).execute();
    }
    count(table, rows.length);
    movedItems[table] = rows.map((r) => r.id);
  }
  for (const f of await visible(from.from("facts").select(["id", "superseded_by"]).where("person_id", "in", ids), v, "facts").execute())
    if (f.superseded_by && map.has(f.superseded_by))
      await into
        .update("facts")
        .set({ superseded_by: map.get(f.superseded_by)! })
        .where("id", "=", map.get(f.id)!)
        .execute();

  const movedRels: string[] = [];
  for (const r of rels) {
    map.set(r.id, newId());
    await into
      .insert("relationships", { ...unbooked(r), id: map.get(r.id)!, from_id: personThere(r.from_id)!, to_id: personThere(r.to_id)!, ...(await links(r)) })
      .execute();
    count("relationships");
    movedRels.push(r.id);
  }

  const groupsThere = new Map<string, string>();
  for (const m of memberships) {
    if (!groupsThere.has(m.group_id)) groupsThere.set(m.group_id, await groupThere(from, into, m.group_id));
    await into
      .insert("group_members", { ...unbooked(m), group_id: groupsThere.get(m.group_id)!, person_id: map.get(m.person_id)!, ...(await links(m)) })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  count("group_members", memberships.length);

  for (const h of homes)
    await into
      .insert("place_owners", {
        ...unbooked(h),
        place_id: (await placeThere(h.place_id))!,
        person_id: map.get(h.person_id)!,
        ramble_id: await rambleThere(h.ramble_id),
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  count("place_owners", homes.length);

  for (const p of persons)
    if (p.created_from && map.has(p.created_from))
      await into
        .update("persons")
        .set({ created_from: map.get(p.created_from)! })
        .where("id", "=", map.get(p.id)!)
        .execute();

  // ---- what leaves the source book ----------------------------------------------------------------------------------------
  for (const table of ITEM_TABLES) if (movedItems[table].length) await from.delete(table).where("id", "in", movedItems[table]).execute();
  if (movedRels.length) await from.delete("relationships").where("id", "in", movedRels).execute();
  await visible(from.delete("group_members").where("person_id", "in", ids), v, "group_members").execute();
  await visible(from.delete("place_owners").where("person_id", "in", ids), v, "place_owners").execute();
  // The moved people leave what came along; what stays there for others keeps it, without them.
  if (movedConversations.length) await from.delete("participants").where("conversation_id", "in", movedConversations).where("person_id", "in", ids).execute();
  if (movedExperiences.length) await from.delete("experience_people").where("experience_id", "in", movedExperiences).where("person_id", "in", ids).execute();
  if (movedEntries.length) await from.delete("journal_mentions").where("entry_id", "in", movedEntries).where("person_id", "in", ids).execute();
  // A person first mentioned in a conversation doesn't keep it (created_from is set null when it goes).
  await dropUnheld(from, "conversations", movedConversations, ["participants", "persons"]);
  await dropUnheld(from, "experiences", movedExperiences, ["experience_people"]);
  await dropUnheld(from, "journal_entries", movedEntries, ["journal_mentions"]);
  await dropUnheld(from, "rambles", [...rambles.keys()], []);
  // A check-in interval of a member who isn't in the target book is theirs: it keeps an entry for the person.
  const theirs = new Set(
    (await from.from("person_settings").select(["person_id", "user_id"]).where("person_id", "in", ids).execute())
      .filter((x) => !dstUsers.has(x.user_id))
      .map((x) => x.person_id),
  );
  const gone = await dropUnheld(
    from,
    "persons",
    ids.filter((id) => !theirs.has(id)),
    [...FOLLOWS_PERSON],
  );

  // ---- what stayed, of what the mover may see -----------------------------------------------------------------------------
  const stayed: Record<string, number> = {};
  const left = (table: string, n: number) => n && (stayed[table] = n);
  for (const table of ITEM_TABLES) left(table, (await visible(from.from(table).select("id").where("person_id", "in", ids), v, table).execute()).length);
  left(
    "relationships",
    (
      await visible(
        from
          .from("relationships")
          .select("id")
          .where((eb) => eb.or([eb("from_id", "in", ids), eb("to_id", "in", ids)])),
        v,
        "relationships",
      ).execute()
    ).length,
  );
  const expLeft = (await from.from("experience_people").select("experience_id").where("person_id", "in", ids).execute()).map((r) => r.experience_id);
  left(
    "experiences",
    expLeft.length ? (await visible(from.from("experiences").select("id").where("id", "in", expLeft), v, "experiences").execute()).length : 0,
  );
  const entriesLeft = (await from.from("journal_mentions").select("entry_id").where("person_id", "in", ids).execute()).map((r) => r.entry_id);
  left(
    "journal_entries",
    entriesLeft.length ? (await visible(from.from("journal_entries").select("id").where("id", "in", entriesLeft), v, "journal_entries").execute()).length : 0,
  );
  left("group_members", (await visible(from.from("group_members").select("group_id").where("person_id", "in", ids), v, "group_members").execute()).length);
  left("place_owners", (await visible(from.from("place_owners").select("place_id").where("person_id", "in", ids), v, "place_owners").execute()).length);
  const stillIn = (await from.from("participants").select("conversation_id").where("person_id", "in", ids).execute()).map((r) => r.conversation_id);
  left(
    "conversations",
    stillIn.length ? (await visible(from.from("conversations").select("id").where("id", "in", stillIn), v, "conversations").execute()).length : 0,
  );

  return {
    people: persons.map((p) => ({ from: p.id, id: map.get(p.id)!, name: p.name, url: personPath(map.get(p.id)!), remains: !gone.has(p.id) })),
    moved,
    stayed,
  };
}

/** The target's group for a source group: the household's own, else one of the same name or other name, else a new one. */
async function groupThere(from: Scope, into: Scope, id: string): Promise<string> {
  const g = await from.from("groups").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
  if (g.household) return (await into.from("groups").select("id").where("household", "=", 1).executeTakeFirstOrThrow()).id;
  const named = (await into.from("groups").select(["id", "name"]).execute()).find((x) => norm(x.name) === norm(g.name));
  const alias = named ? undefined : await into.from("group_aliases").select("group_id").where("norm", "=", norm(g.name)).executeTakeFirst();
  const same = named?.id ?? alias?.group_id;
  if (same) return same;
  const copy = newId();
  await into.insert("groups", { id: copy, name: g.name, created_by: from.v.userId, created_at: g.created_at, seeded: 0, household: 0 }).execute();
  const aliases = await from.from("group_aliases").select(["alias", "norm"]).where("group_id", "=", id).execute();
  if (aliases.length)
    await into
      .insert(
        "group_aliases",
        aliases.map((a) => ({ group_id: copy, alias: a.alias, norm: a.norm })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  return copy;
}

/** Deletes the rows of `table` among `ids` that nothing in the book points at any more (`except` the tables that go with them). */
async function dropUnheld(s: Scope, table: BookTable, ids: string[], except: string[]): Promise<Set<string>> {
  const gone = new Set<string>();
  if (!ids.length) return gone;
  const holders = Object.entries(REFS).flatMap(([t, cols]) =>
    Object.entries(cols as Record<string, string>).flatMap(([col, target]) =>
      target === table && !except.includes(t) ? [[t as BookTable, col] as const] : [],
    ),
  );
  for (const id of ids) {
    let held = false;
    for (const [t, col] of holders) {
      if (
        await s
          .from(t)
          .select("book_id")
          .where(col as never, "=", id as never)
          .executeTakeFirst()
      ) {
        held = true;
        break;
      }
    }
    if (held) continue;
    await s
      .delete(table)
      .where("id" as never, "=", id as never)
      .execute();
    gone.add(id);
  }
  return gone;
}
