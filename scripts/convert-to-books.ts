// One-off: converts the database of the only instance from before books (162) into the baseline schema, as one book whose
// members are its users. Run once, by hand, on a copy taken while freundebuch is stopped; deleted in the pull request after.
//
//   npx jiti scripts/convert-to-books.ts <old.db> <new.db>
//
// Ids, visibility and who recorded what stay as they were. Rows that share a created_at get 1 ms apart in their old order, so
// `created_at, id` keeps the order rowid gave them. It checks every table against the old one and exits non-zero on a mismatch.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { connect } from "../backend/db/connect";
import { migrate } from "../backend/db/migrations";
import { isBookTable } from "../backend/db/tables";
import { FIRST_BOOK } from "../backend/core/users";
import { MIGRATION_NAMES as OLD_MIGRATIONS } from "./fixtures/old-migrations";

export type Report = { book: string; tables: Record<string, { old: number; new: number }>; mismatches: string[] };

const columns = (d: Database.Database, schema: string, table: string): string[] =>
  (d.prepare(`select name from pragma_table_info(?, ?)`).all(table, schema) as { name: string }[]).map((c) => c.name);
const q = (name: string) => `"${name}"`;

export async function convert(oldFile: string, newFile: string, bookName = FIRST_BOOK): Promise<Report> {
  if (!existsSync(oldFile)) throw new Error(`no database at ${oldFile}`);
  if (existsSync(newFile)) throw new Error(`${newFile} exists; convert into a new file`);
  // Only the schema the 21 old migrations leave is copied column by column; anything else would lose columns without a word.
  const ran = new Database(oldFile, { readonly: true });
  const names = (ran.prepare("select name from kysely_migration order by name").all() as { name: string }[]).map((r) => r.name);
  ran.close();
  if (names.join() !== [...OLD_MIGRATIONS].sort().join())
    throw new Error(
      `the old database is not at the last migration before books (${names.at(-1) ?? "none"}); start the last old image on it once, then convert`,
    );
  const k = await connect(newFile);
  await migrate(k);
  await k.destroy();

  const d = new Database(newFile);
  d.pragma("foreign_keys = OFF");
  d.prepare("attach database ? as old").run(oldFile);
  const tables = (
    d.prepare("select name from main.sqlite_master where type = 'table' and name not like 'kysely%' and name not like 'sqlite%'").all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((t) => t !== "books" && t !== "members");
  const oldTables = new Set((d.prepare("select name from old.sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name));
  const owner = d.prepare("select id, created_at from old.users order by created_at, rowid limit 1").get() as { id: string; created_at: number } | undefined;
  if (!owner) throw new Error("the old database has no users");
  const book = randomUUID();

  d.transaction(() => {
    d.prepare("insert into books (id, name, created_by, created_at) values (?, ?, ?, ?)").run(book, bookName, owner.id, owner.created_at);
    for (const t of tables) {
      if (!oldTables.has(t)) continue;
      const shared = columns(d, "main", t).filter((c) => c !== "book_id" && columns(d, "old", t).includes(c));
      const select = shared.map((c) => (c === "created_at" ? `created_at + (row_number() over (partition by created_at order by rowid) - 1)` : q(c)));
      const into = isBookTable(t) ? [...shared, "book_id"] : shared;
      const values = isBookTable(t) ? [...select, "?"] : select;
      d.prepare(`insert into main.${q(t)} (${into.map(q).join(", ")}) select ${values.join(", ")} from old.${q(t)} order by rowid`).run(
        ...(isBookTable(t) ? [book] : []),
      );
    }
    d.prepare(
      "insert into members (book_id, user_id, person_id, created_at) select ?, id, person_id, created_at from old.users where person_id is not null order by created_at, rowid",
    ).run(book);
  })();

  // The checks: same rows in every table (every column the two share, created_at aside), the members, and no broken key.
  const report: Report = { book, tables: {}, mismatches: [] };
  for (const t of tables.filter((t) => oldTables.has(t))) {
    const count = (schema: string) => (d.prepare(`select count(*) as n from ${schema}.${q(t)}`).get() as { n: number }).n;
    report.tables[t] = { old: count("old"), new: count("main") };
    if (report.tables[t].old !== report.tables[t].new) report.mismatches.push(`${t}: ${report.tables[t].old} rows before, ${report.tables[t].new} after`);
    const cols = columns(d, "main", t)
      .filter((c) => c !== "book_id" && c !== "created_at" && columns(d, "old", t).includes(c))
      .map(q)
      .join(", ");
    const differ = (d.prepare(`select count(*) as n from (select ${cols} from old.${q(t)} except select ${cols} from main.${q(t)})`).get() as { n: number }).n;
    if (differ) report.mismatches.push(`${t}: ${differ} rows differ`);
    if (columns(d, "main", t).includes("book_id")) {
      const outside = (d.prepare(`select count(*) as n from main.${q(t)} where book_id is not ?`).get(book) as { n: number }).n;
      if (outside) report.mismatches.push(`${t}: ${outside} rows outside the book`);
    }
  }
  const users = (d.prepare("select count(*) as n from old.users where person_id is not null").get() as { n: number }).n;
  const members = (d.prepare("select count(*) as n from members").get() as { n: number }).n;
  if (users !== members) report.mismatches.push(`members: ${users} users with a person, ${members} members`);
  const broken = d.prepare("pragma main.foreign_key_check").all();
  if (broken.length) report.mismatches.push(`${broken.length} broken references: ${JSON.stringify(broken.slice(0, 5))}`);
  d.close();
  return report;
}

const [, script, oldFile, newFile] = process.argv;
if (script?.endsWith("convert-to-books.ts") && oldFile && newFile) {
  convert(oldFile, newFile).then(
    (r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.mismatches.length ? 1 : 0);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
