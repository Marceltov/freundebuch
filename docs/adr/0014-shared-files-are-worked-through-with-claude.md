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

Chosen option: Prüfen with Claude, keeping only text.

* Images, PDFs and plain text are taken; the table `screenshots` becomes `files` (migration 010). Claude's first read is a suggestion plus a **transcript** (the file's text word for word, or what a photo shows) and never files.
* In the app, **In Erzählen öffnen** starts a chat on the file; over MCP the tool `inbox` hands the waiting files to any Claude. Filing goes through `record_conversation` with `fileIds`: the files' transcripts join the conversation's transcript, and the files are deleted. Closing or discarding a file deletes it too.
* **Only transcripts are kept, from any source.** A shared file lives only until it is reviewed. A file pasted into an outside Claude can't reach a tool anyway: Claude writes out what it shows into the transcript, which is all freundebuch would keep.

### Consequences

* Good, because any file works, and the conversation asks about people and privacy as a ramble does: nothing private is filed as shared unasked.
* Good, because there is one way of filing, the tools, and one kind of evidence, the transcript, which follows the conversation's privacy.
* Good, because files of other people's messages are not stored for good: less to leak, less to back up.
* Bad, because the original is gone after the review: a photo is kept only as its description.
* Bad, because nothing is filed until the user opens Prüfen once, and the REST routes moved (`/files`, `resolve` is gone).
