---
status: accepted
date: 2026-11-04
decision-makers: Marcel Bruckner
---

# Todoist tasks and follow-ups

## Context and Problem Statement

The daily reminder is a push to a webhook. A push is easy to swipe away, and it cannot be ticked off. The people who keep a book already live in a task app, so what is due could be a task there, on its day, and a tick could come back. The tick must not file anything on its own ([V5](../values.md#v5-you-decide-what-is-filed)), and a private item must never reach the other user's Todoist ([V2](../values.md#v2-private-stays-private-through-every-door)).

## Considered Options

* **A personal API token and polling** (chosen).
* **A Todoist app with sign-in and webhooks**: ticks arrive at once, but it needs an app registered at Todoist, a client id and secret, and a public URL for the webhooks. A self-hosted instance with none of that could not use it at all (V6). Kept as a later step, on the same seam.
* **The Todoist connector in the user's Claude chat**: Claude would create the tasks while the user chats. Nothing would happen on a day the user does not talk to Claude, and a tick would never come back.

## Decision Outcome

Chosen option: each user connects their own Todoist with a personal API token and freundebuch polls.

* The token is stored like the webhook URL: in plaintext in the database, never logged and never returned (the API says only whether one is set). It belongs to the user and works only for that user's own items.
* Every five minutes, and before `whats_due` and a briefing answer, freundebuch creates a task for each item the user's own `dueAcross(viewer)` reports, and reads which tasks were ticked. It is one task per item, not one per day. Per kind (birthdays, anniversaries, other dates, promises) the user sets how many days ahead (0 to 60) and whether the item's day is the task's due date or its deadline.
* Delivery is a user setting: push, Todoist or both. `todoist` falls back to the push when Todoist is not usable, so nothing is missed. A token Todoist rejects marks the connection broken, and the settings page says so.
* A tick means what the kind says: a date is closed and nothing else happens; a promise is marked done (as `correct done`); an overdue person, a situation or a missed session becomes a follow-up. A task whose item was resolved in freundebuch first is closed in Todoist.
* A follow-up is a row in the book table `follow_ups`, private to whoever ticked, with the day. Whether it is resolved is derived when read, not stored: an overdue follow-up ends when a conversation with the person is filed after it, a situation's when its `checkAfter` changes or the situation is marked over, and a session's when the series has a session on or after the day. Claude sees open follow-ups in `whats_due` and in the `next` of a briefing and asks how it went. `correct contact` closes one as a plain contact: the last-seen date moves to the ticked day and nothing else is filed.

### Consequences

* Good, because it works on any self-hosted instance without a Todoist app, a public URL or an extra secret (V6).
* Good, because a tick only ever opens a question for Claude to ask; nothing is filed from it (V5).
* Good, because tasks are made from the user's own `dueAcross`, exactly like the push, so a private item stays out of the other user's Todoist (V2). Follow-ups are private to their user.
* Good, because deriving the resolution means a follow-up can never be left open by a missed write.
* Bad, because a tick takes up to five minutes to arrive, except before `whats_due` and a briefing.
* Bad, because the token is a full-access personal token in plaintext in the database, like the webhook URL: whoever can read the database can act as the user in Todoist.
* Bad, because the MCP output of `whats_due` and `briefing` changed: open claude.ai chats need a new chat.
