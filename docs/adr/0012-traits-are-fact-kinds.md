---
status: accepted
date: 2026-10-28
decision-makers: Marcel Bruckner
---

# Traits are fact kinds

## Context and Problem Statement

We want to keep what lasts about how a person is and what they need ([#46](https://github.com/Marceltov/freundebuch/issues/46)): "needs a wheelchair", "vegetarian", "gets angry quickly". So far these could only be filed as lasting facts, mixed with "works at Hornbach", and nothing brought them forward when they matter: before meeting someone, and when planning an evening with several people. A trait is either a **need**, something to plan around, or **personality**, how the person is and how to deal with them.

## Considered Options

* **Two new fact kinds** (chosen): `facts.kind` goes from `lasting | situation` to `lasting | situation | need | personality`.
* **A separate `traits` table**, with its own kind column.

## Decision Outcome

Chosen option: two new fact kinds. A trait is a lasting fact with a sharper role. As a fact it keeps everything facts already have: privacy through `visible()`, `correct` (edit, outdated, delete, visibility), `supersedes`, editing by either user ([ADR 0011](0011-either-user-edits-shared-items.md)), item links and REST. Turning an existing fact into a trait is an edit of its `kind`, which is how the facts filed before this get moved over.

* A trait keeps its `category` (a wheelchair is a `need` in `health`) and never has a `checkAfter`; it doesn't nudge.
* The briefing returns `traits: { needs, personality }` apart from `known`, and its `next` names the needs.
* A new read-only tool `traits` (and `GET /api/v1/traits`) takes any mix of people and groups and returns each person once with their traits; a group stands for the members the caller sees.
* Migration `008_traits` rebuilds `facts`, since SQLite can't change a CHECK constraint in place.

### Consequences

* Good, because traits come with privacy, editing and links for free; there is no second set of item plumbing to keep private.
* Good, because a fact filed as lasting can become a trait with one edit.
* Bad, because every read of facts has to say which kinds it wants: `known` now means `lasting` only.
* Bad, because a trait carries a category it doesn't strictly need.
