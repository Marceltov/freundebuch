---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# Household members are persons in the relationship graph

## Context and Problem Statement

Who someone is to the household ("our landlady", "Marcel's colleague", "our doctor") was filed as a fact, next to what is going on in their life. It is the first thing the user wants to know about a person, and it is a relationship, not news. Relationships so far connect two persons of the book. How does freundebuch model "us", and where does it store the graph a person page draws?

## Considered Options

* **A household person** ("Marcel & Sybille") that roles point at. A person who is not a person; it would show up in the people list, in search and in the orbit, and "only Sybille's colleague" can't be said.
* **A role column on persons** ("landlord"). Shared by both users, so a role one user wants private can't be; and it can't say to whom.
* **Relationships to the household persons** (chosen): the persons some `users.person_id` points at. A role is an ordinary relationship whose other end is one of them; a role to both of us is one relationship per household person.
* **A graph database** for the network view. One hop around a person is two indexed queries in SQLite, and privacy would have to be rebuilt outside `visible()`.

## Decision Outcome

Chosen option: relationships to the household persons, stored in SQLite.

* The tools take `"me"` (the caller's own person) and `"us"` (every household person) in place of a person id. `"us"` expands to one row per household person, each through `relationshipKey` and the dedupe in `insertRelationship`, so filing "us" when one half exists adds only the other half.
* New relationship types for roles: `landlord`, `doctor` and `service` (directional: from is the landlord / doctor of to, from works for to), and `neighbour` (symmetric). There is no `tenant`: "we rent from her" is landlord from her to us.
* "Unsere" is computed per viewer: the briefing's `roles` groups the visible relationships to household persons by key, and says `us` only when the viewer sees one to every household person; otherwise `me` or `partner`. A private relationship of the partner is never read, so it can't turn "von dir" into "Unsere", add a node to the network or leave a gap.
* The network is one hop: the person, the household persons with a visible relationship to them, and the person's own people, built from the same visible rows.
* Persons get an optional gender (`female`, `male`, `nonbinary`) so the labels read "Vermieterin" or "Vermieter"; unknown reads "Vermieter:in". Claude sets it only when the user states it or uses a pronoun, never from the name.

### Consequences

* Good, because no person exists that isn't one, and a role can be private, shared, to one of us or to both.
* Good, because every read still goes through `visible()`, and the existing duplicate checks apply to roles too.
* Bad, because a role to both of us is two rows: changing its note or visibility is done per row (the briefing lists both ids).
* Bad, because a third user would be part of "us" too; freundebuch is made for one household of two.
