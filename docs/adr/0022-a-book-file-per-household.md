---
status: proposed
date: 2026-10-31
decision-makers: Marcel Bruckner
---

# A database file per household

## Context and Problem Statement

An instance held one household: everyone who signed in shared one book. A hosted freundebuch, or one instance for a few families, needs several households on one instance, each with a book of its own that no other household sees into ([#69](https://github.com/Marceltov/freundebuch/issues/69), [V1](../values.md#v1-a-book-for-each-household)). Every feature stays on a self-hosted instance ([V6](../values.md#v6-self-hosting-has-everything)).

Privacy inside a household is already one function, `visible()` ([ADR 0002](0002-privacy-model.md)). Between households the bar is higher: V1 rules out *anything* one household can see of another's, people or groups shared across households included.

## Considered Options

* **One SQLite file per household, and a small instance database for who signs in to which** (chosen).
* **A `household_id` on every table**, and every query filtered by it.
* **One instance per household**, households only as separate deployments.

## Decision Outcome

Chosen option: a file per household. The household's book is `freundebuch.db` for the first household ("home"), the file every instance had, and `households/<id>.db` for every other. `instance.db` holds only the households, which household each sign-in identity is in, and the open invitations: nothing about the people in a book.

* **`db(book)` takes the household.** A `Viewer` carries its `householdId`, so `db(v)` opens the viewer's book; the type checker finds every query that doesn't say whose book it reads. Background work (reminders, reflections, pre-reading shared files, clean-up) goes through every household.
* **Inside a book nothing changes.** "Us" is still the users of the book, the household group is still seeded per book, and `visible()` still decides between its users.
* **`FREUNDEBUCH_HOUSEHOLDS=one`** (the default) keeps everything as it was: everyone who signs in is in home. **`many`**: a first sign-in joins the household whose invitation it followed, or starts a book of its own. Who may sign in at all stays authentik's.
* **An invitation** is a link to the sign-in page (`/login?invite=…`), made by a member over MCP (`invite`), REST or Settings → Haushalt. It is good once, for a week, and only its hash is kept. It is for the people a user lives with, never for the people in the book ([V3](../values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)). Someone who already has a household stays in it; an invitation doesn't move them.
* **Keys looked up before anyone signs in** (the calendar feed, the Shortcut's share key) name their household: `fbc_<household>~<secret>`. Home's keys carry none, so the keys made before households keep working.
* **An instance from before** needs no migration: its users are in home, and each is recorded in `instance.db` on their next sign-in.

### Consequences

* Good, because a query that forgets the household doesn't compile, and one that reads the wrong book can only read one whole book: there is no `where` to forget.
* Good, because a household's book is one file: backing it up, handing it over or deleting it is copying or removing that file ([V6](../values.md#v6-self-hosting-has-everything)).
* Good, because a single-household instance runs exactly as before.
* Bad, because every household's migrations run when its book is first opened, not all at start-up; a failing one shows for that household only.
* Bad, because nothing can be counted across households in SQL. That is on purpose (V1), but an operator's view of a hosted instance (how many households, how big) has to be built from the files and `instance.db`.
* Bad, because each open book is an open SQLite connection. Fine for tens of households; a large hosted instance would close idle ones.

## More Information

A `household_id` on every table was ruled out because its safety rests on every one of a few hundred queries remembering a `where`, with no help from the types, for the strongest promise freundebuch makes. Separate deployments per household work today, but they are not "several households per instance" and leave a hosted freundebuch running hundreds of containers.

Not decided here: moving someone from one household to another, leaving a household, and deleting one. Each is a file operation plus a row in `instance.db`, and each wants its own decision.
