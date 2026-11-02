// One person across books (ADR 0029): the user says that Lena in Arbeit and Lena in Unser Buch are the same, and from then
// on she is one person to them. A link is the user's own, kept outside every book (instance tables, keyed by the user), so
// no other member sees it or reads anything differently. Co-members need no link: their persons are one by their user.
// Every read checks a link's parts against the books the user is in now, so a book they left drops out on its own.
import { newId, now } from "../db";
import { instance, type InstanceDb } from "../db/scope";
import { InvalidInputError, NotFoundError } from "../core/errors";
import type { Viewer } from "../core/types";
import { bookRef, type BookRef } from "./books";
import { norm } from "./names";

/** One of a person's rows: the book it is in and its id there. */
export type Part = { book: BookRef; id: string };

type Person = { id: string; book_id: string; name: string };

async function personsIn(i: InstanceDb, v: Viewer, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const rows = await i.scope(v).from("persons").select(["id", "book_id", "name"]).where("id", "in", ids).execute();
  return new Map(rows.map((r) => [r.id, r]));
}

const oldestFirst = <T extends { book: string }>(v: Viewer, xs: T[]) => xs.sort((a, b) => v.books.indexOf(a.book) - v.books.indexOf(b.book));
// Inside a transaction, through it: the database has one connection, and a read beside it would wait for it forever.
const bookName = async (i: InstanceDb, id: string) => (await i.from("books").select("name").where("id", "=", id).executeTakeFirstOrThrow()).name;
const toParts = (xs: { id: string; book: string }[]): Promise<Part[]> => Promise.all(xs.map(async (x) => ({ book: await bookRef(x.book), id: x.id })));

/** Every person in the viewer's books that is one with others: a member's person by their user (`u:`), a linked one by its
 * link (`l:`, only while two or more of its parts are in the viewer's books); with the book it is in. */
async function identities(i: InstanceDb, v: Viewer): Promise<Map<string, { key: string; book: string }>> {
  const [members, parts] = await Promise.all([
    i.from("members").select(["person_id", "user_id", "book_id"]).where("book_id", "in", v.books).execute(),
    i.from("person_link_parts").select(["link_id", "person_id", "book_id"]).where("user_id", "=", v.userId).where("book_id", "in", v.books).execute(),
  ]);
  const out = new Map(members.map((m) => [m.person_id, { key: `u:${m.user_id}`, book: m.book_id }]));
  const count = new Map<string, number>();
  for (const p of parts) count.set(p.link_id, (count.get(p.link_id) ?? 0) + 1);
  // Someone's own person is one by their user, never by a link.
  for (const p of parts) if (count.get(p.link_id)! >= 2 && !out.has(p.person_id)) out.set(p.person_id, { key: `l:${p.link_id}`, book: p.book_id });
  return out;
}

/** Person id → who they are across the viewer's books, for every person that is one with others; the rest are absent. */
export async function sameAs(v: Viewer): Promise<Map<string, string>> {
  return new Map([...(await identities(await instance(), v))].map(([id, x]) => [id, x.key]));
}

/** The person's rows in the viewer's books, oldest book first: just the person when they are one of a kind. */
export async function partsOf(v: Viewer, personId: string): Promise<Part[]> {
  const i = await instance();
  const all = await identities(i, v);
  const mine = all.get(personId);
  if (mine)
    return toParts(
      oldestFirst(
        v,
        [...all].filter(([, x]) => x.key === mine.key).map(([id, x]) => ({ id, book: x.book })),
      ),
    );
  const p = (await personsIn(i, v, [personId])).get(personId);
  if (!p) throw new NotFoundError("No such person");
  return toParts([{ id: p.id, book: p.book_id }]);
}

/**
 * Links people of the user's books as one person, at most one per book; a link one of them is in already takes the others,
 * and two such links become one. Someone's own person can't be linked (they are one by their user already). A "not the same"
 * between them is dropped. Returns the person's parts.
 */
export async function linkPeople(v: Viewer, ids: string[]): Promise<Part[]> {
  const wanted = [...new Set(ids)];
  if (wanted.length < 2) throw new InvalidInputError("Name at least two people to link");
  const parts = await (
    await instance()
  ).transaction(async (tx) => {
    const found = await personsIn(tx, v, wanted);
    const missing = wanted.find((id) => !found.has(id));
    if (missing) throw new NotFoundError(`No person with the id ${missing} in your books`);
    const member = await tx.from("members").select(["person_id", "book_id"]).where("person_id", "in", wanted).executeTakeFirst();
    if (member)
      throw new InvalidInputError(
        `${found.get(member.person_id)!.name} is someone's own person in ${await bookName(tx, member.book_id)}; they are one across books already`,
      );
    const theirs = await tx.from("person_link_parts").select("link_id").where("user_id", "=", v.userId).where("person_id", "in", wanted).execute();
    const links = await tx
      .from("person_links")
      .select(["id", "created_at"])
      .where("id", "in", [...new Set(theirs.map((t) => t.link_id)), ""])
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    const old = links.length
      ? await tx
          .from("person_link_parts")
          .select(["book_id", "person_id"])
          .where(
            "link_id",
            "in",
            links.map((l) => l.id),
          )
          .where("book_id", "in", v.books)
          .execute()
      : [];
    const names = await personsIn(
      tx,
      v,
      old.map((o) => o.person_id),
    );
    const byBook = new Map<string, string>();
    for (const [book, id] of [...old.map((o) => [o.book_id, o.person_id]), ...wanted.map((id) => [found.get(id)!.book_id, id])]) {
      const other = byBook.get(book);
      if (other && other !== id) {
        const name = (x: string) => (found.get(x) ?? names.get(x))!.name;
        throw new InvalidInputError(`${name(other)} and ${name(id)} are both in ${await bookName(tx, book)}: merge them there instead`);
      }
      byBook.set(book, id);
    }
    const keep = links[0]?.id ?? newId();
    if (links.length) {
      await tx
        .delete("person_link_parts")
        .where(
          "link_id",
          "in",
          links.map((l) => l.id),
        )
        .execute();
      if (links.length > 1)
        await tx
          .delete("person_links")
          .where(
            "id",
            "in",
            links.slice(1).map((l) => l.id),
          )
          .execute();
    } else await tx.insert("person_links", { id: keep, user_id: v.userId, created_at: now() }).execute();
    const all = [...byBook].map(([book, id]) => ({ book, id }));
    await tx
      .insert(
        "person_link_parts",
        all.map((p) => ({ link_id: keep, user_id: v.userId, book_id: p.book, person_id: p.id, created_at: now() })),
      )
      .execute();
    const linked = all.map((p) => p.id);
    await tx.delete("person_not_same").where("user_id", "=", v.userId).where("a_id", "in", linked).where("b_id", "in", linked).execute();
    return oldestFirst(v, all);
  });
  return toParts(parts);
}

/** Takes the person out of their link; a link left with fewer than two parts goes. */
export async function unlinkPerson(v: Viewer, personId: string): Promise<void> {
  const i = await instance();
  const part = await i
    .from("person_link_parts")
    .select("link_id")
    .where("user_id", "=", v.userId)
    .where("person_id", "=", personId)
    .where("book_id", "in", v.books)
    .executeTakeFirst();
  if (!part) throw new NotFoundError("That person isn't linked");
  await i.transaction(async (tx) => {
    await tx.delete("person_link_parts").where("link_id", "=", part.link_id).where("person_id", "=", personId).execute();
    const left = await tx.from("person_link_parts").select("person_id").where("link_id", "=", part.link_id).execute();
    if (left.length < 2) await tx.delete("person_links").where("id", "=", part.link_id).execute();
  });
}

/** Keeps the user's answer that two people of different books are not the same, so nobody asks about them again. */
export async function markNotSame(v: Viewer, a: string, b: string): Promise<void> {
  const i = await instance();
  const found = await personsIn(i, v, [a, b]);
  const [pa, pb] = [found.get(a), found.get(b)];
  if (!pa || !pb) throw new NotFoundError(`No person with the id ${pa ? b : a} in your books`);
  if (pa.book_id === pb.book_id) throw new InvalidInputError("They are in one book: only people of two books can be the same");
  const keys = await sameAs(v);
  if (keys.has(a) && keys.get(a) === keys.get(b)) throw new InvalidInputError(`${pa.name} and ${pb.name} are linked: unlink them first`);
  const [x, y] = a < b ? [pa, pb] : [pb, pa];
  const row = { user_id: v.userId, a_book: x.book_id, a_id: x.id, b_book: y.book_id, b_id: y.id };
  const there = await i
    .from("person_not_same")
    .select("a_id")
    .where("user_id", "=", row.user_id)
    .where("a_id", "=", row.a_id)
    .where("b_id", "=", row.b_id)
    .executeTakeFirst();
  if (!there) await i.insert("person_not_same", { ...row, created_at: now() }).execute();
}

/**
 * The people in the user's other books who may be the same as this one: the same name, or another name of theirs that is
 * this one's name; never someone's own person, nobody already one with them, nobody the user said is not. What Claude and
 * the person's page ask about.
 */
export async function nameMatches(v: Viewer, personId: string): Promise<Array<{ id: string; name: string; book: BookRef }>> {
  const i = await instance();
  const me = (await personsIn(i, v, [personId])).get(personId);
  if (!me) throw new NotFoundError(`No person with the id ${personId}`);
  const keys = await identities(i, v);
  const mine = keys.get(personId)?.key;
  if (mine?.startsWith("u:")) return [];
  // A linked person asks as a whole: every part's name, and only about books none of the parts is in (one part per book).
  const ids = mine ? [...keys].filter(([, x]) => x.key === mine).map(([id]) => id) : [personId];
  const parts = [...(await personsIn(i, v, ids)).values()];
  const taken = new Set(parts.map((p) => p.book_id));
  const others = v.books.filter((b) => !taken.has(b));
  if (!others.length) return [];
  const names = [...new Set(parts.map((p) => norm(p.name)))];
  const s = i.scope(v);
  const [persons, aliases, no] = await Promise.all([
    s.from("persons").select(["id", "book_id", "name"]).where("book_id", "in", others).execute(),
    s.from("aliases").select("person_id").where("book_id", "in", others).where("norm", "in", names).execute(),
    i
      .from("person_not_same")
      .select(["a_id", "b_id"])
      .where("user_id", "=", v.userId)
      .where((eb) => eb.or([eb("a_id", "in", ids), eb("b_id", "in", ids)]))
      .execute(),
  ]);
  const aliased = new Set(aliases.map((a) => a.person_id));
  const refused = new Set(no.flatMap((r) => [r.a_id, r.b_id]));
  const hits = persons.filter((p) => {
    if (keys.get(p.id)?.key.startsWith("u:") || refused.has(p.id)) return false;
    return names.includes(norm(p.name)) || aliased.has(p.id);
  });
  return Promise.all(
    oldestFirst(
      v,
      hits.map((p) => ({ ...p, book: p.book_id })),
    ).map(async (p) => ({ id: p.id, name: p.name, book: await bookRef(p.book) })),
  );
}

// ---- inside a move or a merge, on its transaction --------------------------------------------------------------------------

/**
 * A move copied people from `fromBook` into `toBook` (`map`: old id → new id): every user's link takes the new id, unless it
 * has a part in `toBook` already. Returns, for the mover, the part their link already has there (the twin), by old id.
 */
export async function carryLinks(i: InstanceDb, mover: string, fromBook: string, toBook: string, map: Map<string, string>): Promise<Map<string, string>> {
  const twins = new Map<string, string>();
  const parts = await i
    .from("person_link_parts")
    .select(["link_id", "user_id", "person_id"])
    .where("book_id", "=", fromBook)
    .where("person_id", "in", [...map.keys()])
    .execute();
  for (const p of parts) {
    const there = await i.from("person_link_parts").select("person_id").where("link_id", "=", p.link_id).where("book_id", "=", toBook).executeTakeFirst();
    if (there) {
      if (p.user_id === mover) twins.set(p.person_id, there.person_id);
      continue;
    }
    await i
      .insert("person_link_parts", { link_id: p.link_id, user_id: p.user_id, book_id: toBook, person_id: map.get(p.person_id)!, created_at: now() })
      .execute();
  }
  return twins;
}

/** After a move, the people that stayed behind in `fromBook` (old id → new id) are one with their copy, for the mover. */
export async function linkLeftBehind(i: InstanceDb, mover: string, fromBook: string, toBook: string, pairs: Map<string, string>): Promise<void> {
  for (const [old, fresh] of pairs) {
    const mine = await i
      .from("person_link_parts")
      .select("link_id")
      .where("user_id", "=", mover)
      .where("book_id", "=", fromBook)
      .where("person_id", "=", old)
      .executeTakeFirst();
    if (mine) continue; // carryLinks gave the copy the link already, or the link has its twin there
    const link = newId();
    await i.insert("person_links", { id: link, user_id: mover, created_at: now() }).execute();
    await i
      .insert("person_link_parts", [
        { link_id: link, user_id: mover, book_id: fromBook, person_id: old, created_at: now() },
        { link_id: link, user_id: mover, book_id: toBook, person_id: fresh, created_at: now() },
      ])
      .execute();
  }
}

/** A merge in `book` is about to drop `dropId` into `keepId`: every user's link to the one dropped goes to the one kept; when
 * that user has the kept one linked too, the two links become one (a part of a book the kept link has already stays out). */
export async function mergeLinks(i: InstanceDb, book: string, keepId: string, dropId: string): Promise<void> {
  await keepNotSame(i, book, keepId, dropId);
  const parts = await i.from("person_link_parts").select(["link_id", "user_id"]).where("book_id", "=", book).where("person_id", "=", dropId).execute();
  // Kept as someone's own person: they are one by their user, never in a link, so the dropped part leaves its link.
  if (await i.from("members").select("person_id").where("book_id", "=", book).where("person_id", "=", keepId).executeTakeFirst()) {
    for (const p of parts) {
      await i.delete("person_link_parts").where("link_id", "=", p.link_id).where("person_id", "=", dropId).execute();
      const left = await i.from("person_link_parts").select("person_id").where("link_id", "=", p.link_id).execute();
      if (left.length < 2) await i.delete("person_links").where("id", "=", p.link_id).execute();
    }
    return;
  }
  for (const p of parts) {
    const kept = await i
      .from("person_link_parts")
      .select("link_id")
      .where("user_id", "=", p.user_id)
      .where("book_id", "=", book)
      .where("person_id", "=", keepId)
      .executeTakeFirst();
    if (!kept) {
      await i.update("person_link_parts").set({ person_id: keepId }).where("link_id", "=", p.link_id).where("book_id", "=", book).execute();
      continue;
    }
    const taken = new Set((await i.from("person_link_parts").select("book_id").where("link_id", "=", kept.link_id).execute()).map((r) => r.book_id));
    const rest = await i.from("person_link_parts").select(["book_id", "person_id"]).where("link_id", "=", p.link_id).where("book_id", "!=", book).execute();
    for (const r of rest.filter((x) => !taken.has(x.book_id)))
      await i.update("person_link_parts").set({ link_id: kept.link_id }).where("link_id", "=", p.link_id).where("book_id", "=", r.book_id).execute();
    await i.delete("person_links").where("id", "=", p.link_id).execute();
  }
}

// Every user's "not the same" answers about the dropped person hold for the one kept.
async function keepNotSame(i: InstanceDb, book: string, keepId: string, dropId: string): Promise<void> {
  const rows = await i
    .from("person_not_same")
    .selectAll()
    .where((eb) => eb.or([eb.and([eb("a_book", "=", book), eb("a_id", "=", dropId)]), eb.and([eb("b_book", "=", book), eb("b_id", "=", dropId)])]))
    .execute();
  for (const r of rows) {
    const other = r.a_id === dropId ? { book: r.b_book, id: r.b_id } : { book: r.a_book, id: r.a_id };
    if (other.id === keepId) continue;
    const [x, y] = keepId < other.id ? [{ book, id: keepId }, other] : [other, { book, id: keepId }];
    const there = await i
      .from("person_not_same")
      .select("a_id")
      .where("user_id", "=", r.user_id)
      .where("a_id", "=", x.id)
      .where("b_id", "=", y.id)
      .executeTakeFirst();
    if (!there)
      await i.insert("person_not_same", { user_id: r.user_id, a_book: x.book, a_id: x.id, b_book: y.book, b_id: y.id, created_at: r.created_at }).execute();
  }
}
