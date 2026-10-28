---
status: accepted
date: 2026-10-29
decision-makers: Marcel Bruckner
---

# Shared files are worked through with Claude

## Context and Problem Statement

[ADR 0007](0007-social-media-through-shared-screenshots.md) had Claude read a shared screenshot of a social media post unattended and file one fact when it was sure. That fit one kind of file only: a WhatsApp group chat, a photo or a PDF letter holds several people, several facts, a date or a promise, and often something private, and they failed or came back as "nothing". We want to share any file and get what is in it filed, with the same care as a ramble ([#47](https://github.com/Marceltov/freundebuch/issues/47), [#59](https://github.com/Marceltov/freundebuch/issues/59)).

## Considered Options

* **Widen the unattended reading**: several facts, promises and dates per file, and a review list for the unsure ones.
* **Prüfen with Claude** (chosen): every file waits, with a first read as a suggestion; filing happens in a conversation with Claude.

## Decision Outcome

Chosen option: Prüfen with Claude.

* Images, PDFs and plain text are taken; the table `screenshots` becomes `files` (migration 010). Claude's first read is a short suggestion and never files.
* In the app, **In Erzählen öffnen** starts a chat on the file; over MCP the tool `inbox` hands the files themselves to any Claude. Filing goes through `remember` and `record_conversation`, which take `fileIds`: the files are linked (to the conversation, and to a fact when there was one file) and closed.
* A file pasted into an outside Claude can't reach a tool: Claude writes out what it shows into what it files, and offers **Hochladen** when the original should be kept.

### Consequences

* Good, because any file works, and the conversation asks about people and privacy as a ramble does: nothing private is filed as shared unasked.
* Good, because there is one way of filing, the tools, instead of a second one in the reading.
* Bad, because nothing is filed until the user opens Prüfen once; a post that used to land on its own now waits.
* Bad, because the REST routes moved (`/files`) and `resolve` is gone.
