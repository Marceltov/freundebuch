---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# A signed iPhone Shortcut built from source, and files worked through together

## Context and Problem Statement

Sharing from the iPhone needed a Shortcut built by hand from eight steps, including converting photos to JPEG, because the server couldn't read HEIC. And several screenshots of one thing (a chat over three screens, a post and its comments) were read and filed one by one, so Claude saw fragments ([#68](https://github.com/Marceltov/freundebuch/issues/68)). iOS imports only Shortcut files signed on a Mac, and Apple doesn't document their format.

## Considered Options

For the Shortcut:

* **Built by hand on the iPhone**, the signed file committed: sure to import, but opaque, and every change is made again by hand.
* **Generated from a source in the repo**, signed on a Mac (chosen).

For files that belong together:

* **Batches held on the server** until all files of a share have arrived (id, position and count on each upload), read as one.
* **All files in one upload.**
* **Grouped by time** on the server.
* **Every file stands alone; the user selects several under Prüfen** and works them through together; files shared in one go only come pre-selected (chosen).

## Decision Outcome

* `shortcut/source.ts` builds the Shortcut's property list: share sheet, one import question (the Zugang: the share address and the key, split at the space), each item posted to `/api/share` with the key and one batch id per run, and Prüfen opened at the end. `npm run shortcut:sign` (macOS) signs it into `public/shortcuts/An freundebuch.shortcut` and records the source's hash; a test fails when the source changes without a new signature. Einstellungen offers it as **Kurzbefehl laden**.
* HEIC is decoded with `heic-decode` (libheif in WebAssembly) and stored as WebP like every image: no system libraries in the image.
* A file's upload may carry `X-Freundebuch-Batch` (stored as `files.batch_id`, migration 017). It is a hint only: files are stored, pre-read, discarded and filed one by one as before. Prüfen groups files of one batch and selects them when opened on one; with several selected, **Zusammen prüfen** opens the chat on all of them (context `fileIds`), Claude reads them together and `record` files them with all their ids. `inbox` names the batches and tells Claude that files may belong together without one, so it asks the user.

### Consequences

* Good, because a lost upload or a file the user wants to add later fits: it is selected along, nothing waits for a batch to be complete.
* Good, because the Shortcut is reviewed like code, and the hash keeps the signed file in step with it.
* Bad, because each file's pre-read covers only that file; the joint reading happens in the chat.
* Bad, because a change to the Shortcut needs a Mac to sign it, and only the iPhone shows whether the file imports.
