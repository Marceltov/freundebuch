---
hide:
  - toc
---

# Where freundebuch is going

freundebuch started as a personal CRM: you tell Claude about a meeting, and before the next one Claude tells you what is going on in that person's life. It is growing into the hub of your life: what you experience, who you meet where, and what you think, all by talking, never by filling in forms. People stay at its centre, because they are what you ask about before a meeting.

This page says what is planned and why, inside what freundebuch [stands for](values.md), and what has shipped. Each step links its issue and the value it serves. What is planned has no dates, only now, next or later; what shipped carries the day it did (the [release notes](https://github.com/Marceltov/freundebuch/releases) have the rest). A step that is dropped leaves the timeline, with the reason in its issue.

## The idea behind all of it

You only talk; Claude sorts, links and keeps it up. A personal CRM fails when it needs fields filled in and links maintained by hand. Here a ramble is stored once, word for word, and Claude splits it into what it holds (a meeting, a thought about yourself, news about someone, a place) and links the parts, asking only when something is unclear. Claude is the interface: everything works over MCP first ([V7](values.md#v7-ai-native-claude-first)).

## The timeline

<!-- roadmap -->

## Parked

- **A contact book with CardDAV** ([#73](https://github.com/Marceltov/freundebuch/issues/73)): your phone's address book synced with freundebuch, people private or shared by whose book they are in ([V2](values.md#v2-private-stays-private-through-every-door)). Not needed yet.

## Decided against

- **Federation between instances.** A protocol that can never be dropped, trust between servers, deletion across servers you don't control: too much risk to [V2](values.md#v2-private-stays-private-through-every-door) for what is needed. Own cards by link cover it.
- **Sharing notes about people beyond the household.** What you think about someone is your perception; it is worthless to someone who doesn't know them and harmful to someone who does. Only a person's own card crosses ([V3](values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).
- **Fields and forms to maintain by hand,** as Monica has. Whatever freundebuch knows comes from what you tell it.

## Keep it true

The timeline is rendered from [`docs/roadmap.yml`](https://github.com/Marceltov/freundebuch/blob/main/docs/roadmap.yml); on GitHub, read that file. Finish a step in the pull request that finishes it: set `status: done`, replace `when` with a `date`, add the link to its pull request, and move it to the top of the shipped entries. Change the file in the pull request that changes the plan.
