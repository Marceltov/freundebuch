// The only way to the database outside backend/db. A scope is a viewer's books: every query it builds on a book table is narrowed
// to them, and every row it inserts lands in the viewer's book. Instance tables (users, books, members, …) go through instance().
// Joins need no filter of their own: the composite keys keep a joined row in the same book as long as the join follows them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql, type Insertable, type Kysely, type Transaction } from "kysely";
import type { Viewer } from "../core/types";
import { db } from "./index";
import type { Schema } from "./schema";
import type { BookTable, InstanceTable } from "./tables";

type Handle = Kysely<Schema> | Transaction<Schema>;
declare const handle: Kysely<Schema>;

type Ref<T extends string> = T | `${T} as ${string}`;
type Unbooked<T extends BookTable> = Omit<Insertable<Schema[T]>, "book_id">;

export interface Scope {
  readonly v: Viewer;
  /** The instance tables on the same connection (and transaction). */
  readonly instance: InstanceDb;
  from<TE extends Ref<BookTable>>(table: TE): ReturnType<typeof handle.selectFrom<TE>>;
  insert<T extends BookTable>(table: T, values: Unbooked<T> | readonly Unbooked<T>[]): ReturnType<ReturnType<typeof handle.insertInto<T>>["values"]>;
  update<TE extends Ref<BookTable>>(table: TE): ReturnType<typeof handle.updateTable<TE>>;
  delete<TE extends Ref<BookTable>>(table: TE): ReturnType<typeof handle.deleteFrom<TE>>;
  /** Runs `fn` in one transaction; inside one already, in that one. */
  transaction<R>(fn: (s: Scope) => Promise<R>): Promise<R>;
}

export interface InstanceDb {
  from<TE extends Ref<InstanceTable>>(table: TE): ReturnType<typeof handle.selectFrom<TE>>;
  insert<T extends InstanceTable>(
    table: T,
    values: Insertable<Schema[T]> | readonly Insertable<Schema[T]>[],
  ): ReturnType<ReturnType<typeof handle.insertInto<T>>["values"]>;
  update<TE extends Ref<InstanceTable>>(table: TE): ReturnType<typeof handle.updateTable<TE>>;
  delete<TE extends Ref<InstanceTable>>(table: TE): ReturnType<typeof handle.deleteFrom<TE>>;
  transaction<R>(fn: (i: InstanceDb) => Promise<R>): Promise<R>;
  /** A scope on the same connection (and transaction). */
  scope(v: Viewer): Scope;
  /** `select 1`, for the health check. */
  ping(): Promise<void>;
}

// "persons as p" → "p": the name the book filter has to use.
const aliasOf = (table: string) => table.split(/\s+as\s+/i).pop()!;
const inBooks = (table: string, books: readonly string[]) =>
  sql<boolean>`${sql.ref(`${aliasOf(table)}.book_id`)} in (${sql.join(books.map((b) => sql`${b}`))})`;

/** A scope on a given handle; backend/db and its tests only. */
export function scopeWith(h: Handle, v: Viewer): Scope {
  const s: Scope = {
    v,
    get instance() {
      return instanceOn(h);
    },
    from: (table) => (h.selectFrom(table as any) as any).where(inBooks(table, v.books)),
    insert: (table, values) => {
      const rows = (Array.isArray(values) ? values : [values]).map((r) => ({ ...r, book_id: v.bookId }));
      return h.insertInto(table).values(rows as any) as any;
    },
    update: (table) => (h.updateTable(table as any) as any).where(inBooks(table, v.books)),
    delete: (table) => (h.deleteFrom(table as any) as any).where(inBooks(table, v.books)),
    transaction: (fn) => (h.isTransaction ? fn(s) : (h as Kysely<Schema>).transaction().execute((tx) => fn(scopeWith(tx, v)))),
  };
  return s;
}

function instanceOn(h: Handle): InstanceDb {
  const i: InstanceDb = {
    from: (table) => h.selectFrom(table as any) as any,
    insert: (table, values) => h.insertInto(table).values(values as any) as any,
    update: (table) => h.updateTable(table as any) as any,
    delete: (table) => h.deleteFrom(table as any) as any,
    transaction: (fn) => (h.isTransaction ? fn(i) : (h as Kysely<Schema>).transaction().execute((tx) => fn(instanceOn(tx)))),
    scope: (v) => scopeWith(h, v),
    ping: async () => void (await sql`select 1`.execute(h)),
  };
  return i;
}

/** The viewer's books. */
export async function scope(v: Viewer): Promise<Scope> {
  return scopeWith(await db(), v);
}

/** One book, for jobs that run without a user (refreshing cards): nobody's private rows, only the shared ones. */
export async function systemScope(bookId: string): Promise<Scope> {
  return scopeWith(await db(), { userId: "", personId: "", bookId, books: [bookId] });
}

/** The instance tables: users and their settings, own cards, chat usage, books and who is in them. */
export async function instance(): Promise<InstanceDb> {
  return instanceOn(await db());
}
