---
status: accepted
date: 2026-11-02
decision-makers: Marcel Bruckner
---

# The book's own group is its writers

## Context and Problem Statement

[ADR 0013](0013-the-household-is-a-group.md) made everyone who signs in a member of one group, Haushalt, flagged `household`. Since books ([ADR 0025](0025-books-in-one-scoped-database.md)), every book has that group, and its members are the people who write to that book: a couple in a shared book, one person in a work book. "Household" named neither, and the code, the API and Claude's instructions said "the household" for what is really the book's members, "us".

## Considered Options

* **Keep `household`** and explain it: no migration, but the word keeps meaning something the model doesn't have.
* **Call them the book's writers** (chosen): the people who write to the book, whatever their role in it.

## Decision Outcome

Chosen option: the book's writers.

* Migration 004 renames the column `groups.household` to `groups.writers`, and its index to `groups_writers`. Existing groups keep their names.
* A new book's writers group is named after the book. When a starting group (Freunde, Familie, Arbeit or one of their other names) already has that name, it is Wir.
* The network role `household` (REST and MCP) is `writer`; `GroupView.household` is `writers`. Claude's texts say "us" and "the book's writers".
* The rules of ADR 0013 stay: the group may be renamed, but not deleted, merged away or emptied of a writer.
* Roles in a book (owner, admin, member) are unchanged: every writer has one.

### Consequences

* Good, because the word matches the model: a book and the people who write to it.
* Bad, because the REST and MCP output change (`writers`, `writer`): open claude.ai chats need a new chat, as after any schema change.
