---
status: accepted
date: 2026-10-23
decision-makers: Marcel Bruckner
---

# Privacy model: item-level visibility, enforced in the query layer

## Context and Problem Statement

Two household members share one freundebuch. Most of what they record about friends is fine to share, and sharing it is the point: either of them can be briefed before meeting Anna. But some of it was told in confidence ("she and Tom are getting divorced"), and a ramble about one dinner often mixes both. The confidential part must never reach the partner, on any surface: pages, REST, MCP, notifications, the graph, and every count, hint or link derived from the data. What is private, how far privacy reaches, and who may change it has to be one rule in one place, not something each read path or the client's AI remembers.

## Decision Drivers

* A confidence told at an otherwise shareable dinner must not make the whole dinner invisible to the partner.
* Leaks through aggregates count as leaks: a summary, a count, "last seen", a hint in `find_person`, a graph edge, the "created from" link, a notification.
* People are talked about by both users, so the same person must not exist twice.
* Enforcement is server-side, from the caller's identity, never left to Claude.

## Considered Options

* **Visibility per conversation only.** Simple, but a single confidence forces the whole dinner private, and the partner loses the harmless parts.
* **Visibility per item, enforced in the query layer.** (chosen)
* **Separate databases or tenants per user, with explicit sharing.** Strong isolation, but shared friends would be duplicated and every shared fact copied.

## Decision Outcome

Chosen option: "Visibility per item, enforced in the query layer", because it lets one recording be partly private without losing the rest, and one predicate covers every read.

* **Item-level visibility.** Every conversation and every item (fact, promise, date, exchange, relationship, group membership) carries `visibility` (`shared` or `private`) and `recorded_by`. A row is visible to a viewer when it is shared or they recorded it. Every read goes through `visible()` in `backend/visibility.ts`; no read path writes the predicate itself.
* **A private conversation makes every item private.** Inside a shared conversation, individual items may be private.
* **Transcript privacy.** The verbatim transcript is private to the recorder whenever the conversation or any item recorded with it is private (`transcript_private`), because it contains the private part. The partner then sees the conversation's summary and shared items, and `transcript: null`. The flag only ever rises on its own: deleting the private item, sharing it, or sharing the conversation again leaves the transcript private, because its text still holds what was private. Only the recorder lowers it, explicitly (`shareTranscript`: MCP `correct` with `share_transcript`, REST `PATCH /items/conversations/{id}` with `transcriptShared`), and only once neither the conversation nor anything recorded with it is private. The summary must not contain the private part; the capture tool's description tells Claude so.
* **A person's existence, name and aliases are always shared.** Everything else about a person (dates including the birthday, relationships, group memberships) carries visibility. A person first mentioned in private exists for the partner, but the "created from" link is shown only to the recorder, or to the partner when the conversation is shared and shows the person to them (as a participant or through a shared item). Otherwise the link alone would reveal where the person came up.
* **Group names carry no visibility; memberships do.** Each user records their own membership row (keyed by group, person and recorder), so a private membership never blocks or reveals the partner's shared one. A person is in a group for a viewer when any membership row visible to them says so; reads dedupe per viewer.
* **Per-user "last seen", check-in interval and overdue.** Last seen counts only conversations in which the viewer's own person took part, and the viewer's own person is always a participant of what they record. Intervals live in `person_settings` per (user, person); a person without an interval for a user is never overdue for them.
* **Who may change what.** Only the recorder of an item may delete it or change its visibility; the partner trying gets `forbidden`. Either user may mark a shared item done, outdated or settled, add to shared data, and merge persons (a merge keeps every item's visibility). Acting on someone else's private item gets `not_found`, so its existence is not revealed. Recording a shared fact that supersedes a visible shared fact marks it outdated, whoever recorded it. A private fact (including any fact in a private conversation) may only supersede the recorder's own private fact; pointing it at a shared fact is `invalid_input`, because flipping the shared fact to outdated would tell the partner that something private changed. The outdated fact remembers its successor (`facts.superseded_by`), so a successor of a shared fact can't be made private later either, on its own or with its conversation: the same `invalid_input`.

### Consequences

* Good, because a dinner can be shared with one confidence kept back, and the partner still benefits from the rest.
* Good, because privacy is one predicate in one module, and a test runs one fixture through every read function as the partner (`backend/privacy.test.ts`).
* Bad, because every new read function has to use `visible()` and derived values (counts, "last seen", links) need their own thought; the privacy test must grow with each one.
* Bad, because a private item's text may still leak through a summary Claude writes carelessly; the server can only keep the transcript back, not judge the summary.

### Confirmation

`backend/privacy.test.ts` records a household fixture through the real write path and asserts, as the partner, that no private item, transcript, edge, date or "created from" link appears. Every later task that adds a read function extends it.
