---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# Household members are persons in the relationship graph

## Context and Problem Statement

Who someone is to the household ("our landlady", "Marcel's colleague", "our doctor") was filed as a fact, next to what is going on in their life. It is the first thing the user wants to know about a person, and it is a relationship, not news. Relationships so far connect two persons of the book, with a type from a fixed list. How does freundebuch model "us", how does it say what a relationship is, and where does it store the graph a person page draws?

## Considered Options

* **A household person** ("Marcel & Sybille") that roles point at. A person who is not a person; it would show up in the people list, in search and in the orbit, and "only Sybille's colleague" can't be said.
* **A role column on persons** ("landlord"). Shared by both users, so a role one user wants private can't be; and it can't say to whom.
* **Relationships to the household persons** (chosen): the persons some `users.person_id` points at. A role is an ordinary relationship whose other end is one of them; a role to both of us is one relationship per household person.
* **A fixed list of relationship types**, extended with `landlord`, `doctor`, `service` and `neighbour`, and a German word table per type and gender. Every role nobody thought of ("Hebamme", "Klempner", "Patentante") falls into `other` with a note, and each new one needs a table rebuild for the type CHECK.
* **What each end is, in words** (chosen): Claude writes both, in each person's gender.
* **A graph database** for the network view. One hop around a person is two indexed queries in SQLite, and privacy would have to be rebuilt outside `visible()`.

## Decision Outcome

Chosen option: relationships to the household persons, stored in SQLite, each saying in words what its ends are.

* The tools take `"me"` (the caller's own person) and `"us"` (every household person) in place of a person id. `"us"` expands to one row per household person, each through the dedupe in `insertRelationship`, so filing "us" when one half exists adds only the other half.
* There are no relationship types. A relationship stores `label`, what `from` is to `to` ("Vermieterin"), and `inverse`, what `to` is to `from` ("Mieter"), written by Claude in German and in each end's gender. Migration 007 turns the old types into their gender-neutral words ("Elternteil" / "Kind"), an `other` into its note.
* The same relationship is the same words between the same two people, either way round (Anna Mutter of Tom is Tom Sohn of Anna), compared without gender endings or umlauts ("Vermieterin", "Vermieter:in", "Arzt", "Ärztin"). Nothing else in the app depends on what a relationship is.
* "Unsere" is computed per viewer: the briefing's `roles` groups the visible relationships to household persons by key, and says `us` only when the viewer sees one to every household person; otherwise `me` or `partner`. A private relationship of the partner is never read, so it can't turn "von dir" into "Unsere", add a node to the network or leave a gap.
* The network is one hop: the person, the household persons with a visible relationship to them, and the person's own people, built from the same visible rows.
* Persons get an optional gender (`female`, `male`, `nonbinary`). Claude writes the words in it ("Vermieterin", "Vermieter"; "Vermieter:in" when it isn't known) and sets it only when the user states it or uses a pronoun, never from the name. The role line picks "Unsere" or "Unser" by it, or reads "Vermieter:in von uns" without one. Setting a gender returns the person's relationships the caller recorded, which Claude then puts in the new gender: the server can't regender a free word.

### Consequences

* Good, because no person exists that isn't one, and a role can be private, shared, to one of us or to both.
* Good, because every read still goes through `visible()`, and the existing duplicate checks apply to roles too.
* Bad, because a role to both of us is two rows: changing its note or visibility is done per row (the briefing lists both ids).
* Good, because any role can be said in its own word, and a new one needs no migration.
* Bad, because the words are only as consistent as Claude: "Vermieterin" and "Hausbesitzerin" are two relationships. The tool descriptions ask for the usual word.
* Bad, because a gender set in the web app leaves the words as they were until Claude relabels them.
* Bad, because a third user would be part of "us" too; freundebuch is made for one household of two.
