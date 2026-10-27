---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# Either user edits or deletes a shared item

## Context and Problem Statement

[ADR 0002](0002-privacy-model.md) let only an item's recorder edit or delete it. In a household of two that share one book, that blocks ordinary upkeep: when Sybille filed "Ursula ist Sybilles Mama" as a neutral "Elternteil", Marcel could see it but not put it in the right words, and Claude, acting for him, couldn't either. Shared items are shared knowledge; who typed them in matters for privacy, not for who may keep them right.

## Considered Options

* **Recorder only** (ADR 0002). The partner asks the recorder, or the item stays wrong.
* **Either user may edit or delete a shared item** (chosen); visibility and conversations stay the recorder's.
* **Either user may do anything to a shared item**, including making it private. Making the partner's item private would hide it from the person who just acted, or, kept the recorder's, from the partner: either way a surprise, and a way to make shared knowledge disappear for the other.

## Decision Outcome

Chosen option: either user may edit or delete a shared item.

* **Facts, promises, dates, exchanges and relationships** that are shared: either user may edit their fields, delete them, switch a fact between lasting and situation, and turn a fact into a relationship. The item keeps its recorder and its visibility.
* **Visibility** stays the recorder's: only they make an item private or shared.
* **Conversations** stay the recorder's to edit or delete. Deleting one takes its items with it, and some of those may be private to the recorder; its summary and transcript are written around what is private, which only the recorder knows. Sharing a transcript stays theirs too.
* **Private items** are unchanged: the partner never sees them, and acting on one is `not_found`.
* The gender `relabel` list (ADR 0010) covers every relationship the caller sees, since they may now fix all of them.

### Consequences

* Good, because whoever notices a mistake in shared data can fix it, over MCP, REST or the web app.
* Good, because nothing private becomes reachable: every check still starts from `visible()`.
* Bad, because one user can change or delete what the other filed without asking. The household is two people who trust each other; the conversation page and its transcript still show what was originally said.
