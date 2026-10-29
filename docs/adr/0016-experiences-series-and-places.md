---
status: accepted
date: 2026-10-29
decision-makers: Marcel Bruckner
---

# Experiences, series and places are records of their own

## Context and Problem Statement

The user lives through things that are not meetings: a concert, a festival, a trip, a dog-school course with Toffee. Until now they could only be told as a conversation (kind `event`, a free-text `place`) or as a journal entry, and neither answers "which concerts did I go to last year?", "how was dog school so far?" or "where were we with Anna?" ([#67](https://github.com/Marceltov/freundebuch/issues/67)). The ramble as its own record ([ADR 0015](0015-the-ramble-is-its-own-record.md)) was built so further parts can slot in.

## Considered Options

* **Experiences as more conversation kinds** (concert, festival, course next to `event`), a series as a group of conversations, places as text.
* **Experiences, series and places as records of their own** (chosen).

## Decision Outcome

Chosen option: records of their own.

* An **experience** is a part of a ramble: a day, a kind in German words (Claude reuses the kinds in use), a title, a few lines, a place and the people who were there. A conversation may say which experience it happened at (`at`).
* A **series** groups experiences that recur (a course, a weekly training), with a rhythm in days, a start and an end. When a session day passes untold, everyone who was at a session of the series is asked: the morning after in the daily notification, and by Claude (`whats_due`, Erzählen). Only days after the series was filed count, and only the latest; a skipped day, an ended series and a series without a rhythm never remind.
* A **place** is a record with other names, like a person (migration 015 turns each recorder's free-text conversation places into places). A place exists for a viewer only through a part they may see, so a place the other user holds only through private parts is neither found nor reused.
* **Memories stay**: a series is never removed on its own, not when it ends and not when its last session is deleted; deleted on the user's word, its sessions stay as single experiences.

### Consequences

* Good, because a conversation stays a meeting: a concert alone isn't a conversation with nobody, and a festival crowd doesn't count as "seen".
* Good, because the reminders for a course come from what the user tells, without anything to maintain.
* Bad, because places from conversations may exist twice (one per recorder) until merged with `correct place_merge`.
* Bad, because a session the other user told privately is asked about again: the reminder can't know of it without revealing it.
