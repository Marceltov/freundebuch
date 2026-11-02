---
status: accepted
date: 2026-11-02
decision-makers: Marcel Bruckner
---

# Person links belong to the user

## Context and Problem Statement

A user keeps several books ([ADR 0025](0025-books-in-one-scoped-database.md)), and the same person can be in two of them: Anna in the work book and Anna in the shared book. Each book has its own row for her, and books never see into each other. For the user she should be one person: one entry, one briefing, one birthday. Nobody else should learn that the two rows are the same, and nothing anyone else sees should change.

## Considered Options

* **A per-user link table at the instance level, merged in the domain layer** (chosen).
* **A shared identity id on both person rows**: simpler reads, but a book row then points into another book, and every member of each book can read it. That breaks "books never see into each other".
* **Merging only in the web pages**: Claude would still see two Annas, and briefings and reminders would stay split, against MCP first.

## Decision Outcome

Chosen option: a per-user link table.

* Migration 005 adds three instance tables, keyed by the user: `person_links`, `person_link_parts` (one part per book, a person in at most one link per user) and `person_not_same` (the pairs the user said are different). A part goes with its person.
* Nothing links itself. The same name in two books is two people until the user says otherwise: `find_person`, `briefing` and the person's page ask, and a "no" is kept so nobody asks again.
* Someone's own person is never linked. Co-members are one person by their user already.
* Every read checks a link's parts against the user's books now: a book they left drops out, and a link with fewer than two parts left reads as nothing.
* `sameAs(v)` gives every person who they are across the user's books. The lists across books (`find_person`, `people`, `whats_due`, the orbit, Leute, the daily reminder) show a linked person once. `linkedBriefing` briefs each part alone, in its book, with the user's viewer there, then merges them with each item's book.
* A move carries the link to the new id. Someone who stays behind in the old book is linked to the copy, for the mover. A move into the book of another part names the twin, and the two can be merged.

### Consequences

* Good, because privacy stays one function per book: each part is read with `visible()` in its own book, and the link only joins what the user may already see.
* Good, because nobody else sees or is affected by a link: B's lists, counts and briefings stay the same.
* Bad, because every read that lists people has to know about links (`sameAs`), and the MCP output of `find_person`, `people`, `whats_due` and `briefing` changed: open claude.ai chats need a new chat.
