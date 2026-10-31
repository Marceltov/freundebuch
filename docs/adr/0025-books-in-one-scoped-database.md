---
status: proposed
date: 2026-10-31
decision-makers: Marcel Bruckner
---

# Books in one database, reached only through a scope

## Context and Problem Statement

freundebuch was one household per instance: one database, every user in it, "us" meaning everyone who signs in. It is to become a keep-in-touch tool for private people and freelancers, hosted as a service next to self-hosting, where one person keeps several books (a household book shared with their partner, a private one, a work one) and a book has members ([books design](https://github.com/Marceltov/freundebuch/issues/69)). Books must never see into each other, and the data layer must be ready for Postgres without shipping it. With every query written against one shared database, nothing stops a query from forgetting which book it is in.

## Considered Options

* **One database, `book_id` on every table, a scoped query layer** (chosen).
* **A Kysely plugin that adds the book filter to every query** it sees.
* **A database file per book** behind the layer ([#109](https://github.com/Marceltov/freundebuch/pull/109)).

And for the history:

* **Squash the 21 migrations into one baseline and convert the one existing instance once** (chosen).
* **Keep the history and add a migration** that puts `book_id` in every table.

## Decision Outcome

Chosen: one database with a scope, and a new baseline.

* **Books and members.** `books` and `members(book_id, user_id, person_id)`: a member is a person in the book ("me"), "us" is the book's members, and every book has its own Haushalt group. Users, their settings, their own cards and chat usage stay outside books.
* **Every book table carries `book_id`**, and every reference between book tables is a composite key `(book_id, x_id) → x(book_id, id)`, so a row can't point into another book. A `set null` reference keeps a single-column key for the action, because SQLite would null `book_id` too on a composite one.
* **The scope** (`backend/db/scope.ts`) is the only way to book tables: `scope(v).from(table)` narrows to the viewer's books, `insert` puts rows in their book, `update` and `delete` narrow like `from`. Instance tables go through `instance()`; jobs without a user (refreshing cards, pruning files) run book by book in a system scope that sees only shared rows. Item privacy inside a book stays `visible()` ([ADR 0002](0002-privacy-model.md)).
* **Enforced, not remembered.** Outside `backend/db`, importing Kysely (other than its types) is a lint error. In tests, a plugin fails any query on a book table that names no `book_id`, and a schema test fails a table that is neither an instance table nor has `book_id`, or a reference between book tables without the book.
* **One baseline**, written only with the schema builder, so it also compiles for Postgres (a test checks it with Kysely's Postgres compiler). No order relies on `rowid`: `now()` never repeats within the process.
* **Migrations run when the server starts**; a failure stops the start.
* **No upgrade path** from earlier versions. The only instance (162) is converted once by a script outside the app, which checks every table against the old one; the script is removed afterwards.

### Consequences

* Good, because a query that forgets its book fails CI, and nothing in the schema can point across books even if one slipped through.
* Good, because reading across a user's books is one query and moving between books one transaction, on one connection.
* Good, because a move to Postgres keeps the queries; row-level security can be added there as a second guard.
* Bad, because an instance older than this release can't upgrade by itself; there is only the one, and it is converted by hand.
* Bad, because a correlated subquery has to name its book (`whereRef("facts.book_id", "=", "files.book_id")`) for the test check, though the composite keys would keep it in the book anyway.

## Pros and Cons of the Options

### A Kysely plugin adding the filter

* Good, because there is nothing to forget.
* Bad, because it rewrites queries out of sight; subqueries, CTEs and inserts are edge cases. Kept only as the check in tests.

### A database file per book

* Good, because books are apart on disk.
* Bad, because reading across books fans out over files, a move can't be one transaction, and a hosted service would hold a connection per book.

### Keep the history and add a migration

* Good, because older instances would upgrade on their own.
* Bad, because the history is SQLite-shaped (rowid, table rebuilds), the conversion would live in the app for good, and there is no other instance to upgrade.
