# What freundebuch stands for

freundebuch is a personal CRM for a household: after you meet someone, you tell Claude about it, and before you meet them again, Claude tells you what is going on in their life. This page says what it will stay, whoever runs it and whatever it grows into. Everything else follows from it: the features and the design decisions in [docs/adr](https://github.com/Marceltov/freundebuch/tree/main/docs/adr).

It is written for you, if you are deciding whether to trust freundebuch with what you know about the people in your life. It is also the yardstick for every change: a contribution, from a person or an AI, is judged against these points, and a review names the one it touches ("this breaks V2"). Each point says what it rules out, so that it can be used that way.

## Lines never crossed

These three come first. When a feature would be easier, or would sell better, by bending one of them, the feature changes or is not built.

### V1. A book for each household

A book belongs to the people who live together and sign in to it: you and your partner, the household. Everyone who signs in to it is in it, and only they are. It is your memory of the people you know, not a place where those people are. An instance can hold several households, as a hosted one would; each has a book of its own, and no household sees into another's.

**Rules out:** accounts for the people in the book, sharing a book beyond its household, anything one household can see of another's, people or groups shared across households, public profiles, a directory of books.

ADRs: [0001](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0001-ai-first-app-with-built-in-mcp.md), [0003](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0003-authentik-sign-in-and-own-oauth-server.md), [0013](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0013-the-household-is-a-group.md).

### V2. Private stays private, through every door

Anything you file can be private: then it is yours alone, and your partner never sees it, not in a list, a count, a summary, a briefing, a reminder, a link, or anything Claude says to them. One function decides what each of you may see, and every read goes through it.

**Rules out:** a count or a summary that includes the other's private items, an admin view around it, a feature that reads the data without that check, evidence of a private item (a transcript, a file) that is shown where the item isn't.

ADRs: [0002](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0002-privacy-model.md), [0005](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0005-group-visibility-and-other-names.md), [0011](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0011-either-user-edits-shared-items.md).

### V3. Nothing reaches the people in the book unless you send it

freundebuch is about people, not a channel to them. It never contacts anyone on its own: a message to someone in the book, such as birthday wishes, goes out only when you send it, through an integration you set up, after you have seen it. It doesn't tell people they are in it, and doesn't watch them: what it knows comes from what you tell it or share with it yourself.

**Rules out:** messages sent without you sending each one, telling someone they are in the book, invitations to join, syncing the book into other services, logging in to their accounts or scraping their feeds, tracking them online.

ADRs: [0007](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0007-social-media-through-shared-screenshots.md), [0014](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0014-shared-files-are-worked-through-with-claude.md).

## What you can rely on

Why you can trust freundebuch with what you know: what it keeps, who decides what is filed, and where it runs.

### V4. Only words are kept

What you tell Claude is kept as your words: each ramble keeps its transcript, next to the conversations, journal entries and items filed from it. A file you share (a screenshot, a chat, a photo, a letter) is kept only until you have gone through it: then only its transcript stays, the text word for word or what a photo shows, and the file is deleted.

**Rules out:** keeping shared files after their review, storing other people's messages beyond the words you filed, a summary in place of what was said.

ADRs: [0014](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0014-shared-files-are-worked-through-with-claude.md), [0015](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0015-the-ramble-is-its-own-record.md).

### V5. You decide what is filed

Claude files what you tell it and asks when it isn't sure: which person you mean, whether something is private, when to ask again. Nothing is filed unattended: a shared file waits until you go through it, and a guess never becomes a person, a fact or a relationship on its own.

**Rules out:** filing in the background without you, creating a person from a guess, merging people without asking, sending what you shared to anyone but the model that reads it for you.

ADRs: [0001](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0001-ai-first-app-with-built-in-mcp.md), [0010](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0010-tool-results-tell-claude-what-to-do-next.md), [0014](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0014-shared-files-are-worked-through-with-claude.md).

### V6. Self-hosting has everything

freundebuch runs as one container on your own server, with one SQLite file and your files beside it. Every feature is there and nothing calls home; a hosted freundebuch, should there be one, sells running it for you, not features. The code is AGPL-3.0: anyone may run it, and a changed version run as a service stays open. What leaves your server goes where you point it: to the Claude API, only when Claude works for you, and reminders to the notification address you set.

**Rules out:** features only a hosted version has, telemetry, a license check an own instance cannot leave off or that calls home, analytics or third-party scripts, a storage format only freundebuch can read.

ADRs: [0003](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0003-authentik-sign-in-and-own-oauth-server.md), [0006](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0006-in-app-chat-calls-claude.md).

## Principles that follow

### V7. AI-native: Claude first

You talk, Claude files. Everything works over MCP first, and every tool result tells Claude what to do next; the REST API and the web app follow. The web app is for looking things up on the phone and confirming what was filed.

**Rules out:** a feature only the web app has, an MCP tool that lags behind the API, forms as the main way to capture.

ADRs: [0001](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0001-ai-first-app-with-built-in-mcp.md), [0006](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0006-in-app-chat-calls-claude.md), [0010](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0010-tool-results-tell-claude-what-to-do-next.md).

### V8. Either of you keeps the shared book right

What is shared belongs to both of you: either may correct, complete or delete it. Who may see something is decided only by whoever filed it.

**Rules out:** shared items only their recorder may fix, making the other's item private or shared for them.

ADRs: [0011](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0011-either-user-edits-shared-items.md).

### V9. Everything is seen from the household

Who someone is, is said from your side ("our landlady", "Sybille's colleague"), in your own words and in each one's gender. The household is a group like any other, so no list needs an exception for the two of you.

**Rules out:** a fixed list of relationship types, roles filed as plain facts, special cases for the partner outside the household group.

ADRs: [0009](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0009-household-members-in-the-relationship-graph.md), [0013](https://github.com/Marceltov/freundebuch/blob/main/docs/adr/0013-the-household-is-a-group.md).

## Changing this page

The points keep their numbers, so that reviews and issues citing them stay right. A change to this page needs the maintainer's approval and says why in its pull request; a change that weakens one of V1 to V3 is a change to what freundebuch is.
