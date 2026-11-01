---
status: proposed
date: 2026-11-01
decision-makers: Marcel Bruckner
---

# A call works in one book

## Context and Problem Statement

With books ([ADR 0025](0025-books-in-one-scoped-database.md)) one person keeps several: the household's, shared with their partner, and one of their own for work. Claude files a ramble with one connection and one sign-in, so something has to say which book it goes to; and everything the domain does ("us", Haushalt, finding a person by name, the group of that name) is about one book. How does a call find its book?

## Considered Options

* A `book` field on the tools that create something, the book of the ids on the others, and every book for a list.
* A current book per MCP session, switched with a tool.
* The server guessing the book from the people named.

## Decision Outcome

Chosen: the call names its book, or its ids do.

* **The domain works in one book.** A viewer handed to the domain is narrowed to one book: `inBook(v, name or id)` or `inBookOf(v, ids)` (`backend/people/books.ts`). The surfaces narrow; the domain functions stay as they were.
* **MCP** (`backend/mcp/tools.ts`): every tool has a rule. `record` and `calendar_feed` take `book` (optional with one book; with several and none, the call fails and lists them), and the ids they are given must be in it. A tool given ids (`briefing`, `correct`, `relate`, …) runs in their book, and ids from two books are refused. A list (`find_person`, `whats_due`, `search`, …) runs once per book and answers `{ books: [{ book, … }] }`, oldest first. Every result names its book, and a write says where it went once there are two.
* **REST and the web**: the book of the id in the path, else `?book=`, else the user's oldest book, which is also where the web's lists are until it can switch books.
* **Moving** people between books is a tool of its own (`move`): rows are copied with new ids and leave the source when nothing there holds them, so another member's private items keep a remaining entry and never land in a book they aren't in.
* **Per book and member**: the calendar feed and the daily message. The share key stays one per user; a shared file waits in the oldest book and goes where it is filed.

### Consequences

* Good, because a ramble can't land in a book from something said earlier in the chat: each call stands alone, and a wrong book shows in its result.
* Good, because no domain function had to learn about several books, and a write that reached into another book anyway fails on the composite keys.
* Bad, because every list tool answers grouped by book, also for someone with one book.
* Bad, because moved people get new ids: links to them from before the move stop working.

## Pros and Cons of the Options

### A current book per session

* Good, because the write tools stay as they are.
* Bad, because it is state the server keeps per MCP session, and a forgotten switch files a household ramble into the work book unnoticed.

### The server guesses

* Bad, because new people have no book yet, a ramble with people of both books has no answer, and a wrong guess goes unseen (V5).
