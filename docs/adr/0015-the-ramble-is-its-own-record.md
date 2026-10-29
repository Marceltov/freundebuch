---
status: accepted
date: 2026-10-29
decision-makers: Marcel Bruckner
---

# The ramble is its own record

## Context and Problem Statement

freundebuch kept one transcript per conversation: a ramble was a conversation. But people ramble about more than one meeting at a time, and about themselves: what they think, what is on their mind, who they are ([#66](https://github.com/Marceltov/freundebuch/issues/66)). Such a ramble has no meeting to hang on, or several. We want a journal, in the user's own words, that Claude interprets, without the user filling anything in.

## Considered Options

* **Journal entries as items of today's conversation**: no migration, but one transcript still belongs to one conversation, so a ramble only about yourself, or about two meetings, can't be split.
* **Journal entries as facts about your own person**: facts are short statements, not dated entries in your words.
* **The ramble as its own record** (chosen): a ramble holds the transcript; conversations, journal entries and the items filed from them point to it.

## Decision Outcome

Chosen option: the ramble as its own record.

* Table `rambles` holds the transcript and its privacy (migration 011 moves every conversation's into a ramble of its own); `conversations.ramble_id` points to it. `journal_entries` and `journal_mentions` (migration 012) hold the entries and the people they name.
* The MCP tool `record` files one ramble and splits it into its parts: conversations, journal entries, and facts, promises, dates, exchanges, relationships and groups, each optionally naming the conversation it came from (`in`). It **replaces `record_conversation`**, and REST `POST /api/v1/conversations` becomes `POST /api/v1/rambles`: MCP clients read the tool list each session, so nothing depends on the old name.
* **A journal entry is private unless the user shares it**, and a ramble holding a private entry has a private transcript. A ramble exists for the other user only through a part they may see.
* The read tool `journal` returns entries over a period and asks Claude to interpret them; the briefing of a person includes the viewer's own last entries naming them. An opt-in **weekly reflection** pushes a few lines built from the week's entries. Claude reflects patterns and never diagnoses; reflection files nothing.

### Consequences

* Good, because one ramble can hold a meeting, a phone call and what the user thinks about it, each filed where it belongs, all linked to the same words.
* Good, because experiences and places can become further parts of a ramble later without another change to how a ramble is kept.
* Good, because the journal follows the existing privacy rule (`visible()`), so the partner never learns an entry exists.
* Bad, because `record_conversation` is gone: a client that cached the tool list until its next session gets an unknown-tool error once.
* Bad, because the weekly reflection sends the week's entries to Claude unattended, once a week, when the user turned it on.
