---
status: proposed
date: 2026-11-01
decision-makers: Marcel Bruckner
---

# Invitations and roles

## Context and Problem Statement

Until now, whoever authentik let in joined the instance's book: fine for one household on its own instance, wrong as soon as one person keeps several books ([ADR 0026](0026-a-call-works-in-one-book.md)), and wrong for a hosted instance, where a stranger signing up would land in someone else's book. Who gets into a book, and who may manage it?

## Considered Options

* Invitation links per book, roles per member, and a setting for strangers.
* Invitations by email address.
* Keep "everyone authentik lets in", with `FREUNDEBUCH_OIDC_ALLOW` as the only gate.

## Decision Outcome

Chosen: invitation links, roles, and `FREUNDEBUCH_REGISTRATION`.

* **Roles** (`members.role`): the owner made the book and does everything, including deleting it, making admins and handing it on; an admin renames it, invites, and removes members; a member reads and writes and may leave. Leaving, or being removed, deletes what that person marked private in the book; what they shared stays ([V8](../values.md#v8-either-of-you-keeps-the-shared-book-right)), and so does their person. Nobody leaves or deletes their only book.
* **Invitations** (`invitations`, `backend/people/invitations.ts`): a link `/einladung/<token>` that works once, for 7 days, in the role it names; only the token's hash is kept. A new user signing in through it joins the book on the way; a signed-in user joins on the page.
* **Strangers**: without an invitation, a first sign-in gets an empty book of their own when `FREUNDEBUCH_REGISTRATION=open`, and is turned away otherwise (the default); the very first sign-in on a fresh instance always gets a book.
* Over MCP all of it is the `books` tool; REST makes and accepts invitations.

### Consequences

* Good, because nobody lands in a book they weren't invited into, on a hosted instance as on one's own (V1).
* Good, because a link needs no email delivery: the user passes it on however they like (V3).
* Bad, because a link can be forwarded; it works once and expires, and the book's admins see and revoke open ones.

## Pros and Cons of the Options

### Invitations by email address

* Good, because only that address can use it.
* Bad, because it needs verified addresses from every provider and a way to send mail, which freundebuch doesn't have (V3).

### Everyone authentik lets in

* Bad, because one instance could then hold only one book's people, and a hosted one couldn't exist.
