---
status: accepted
date: 2026-10-28
decision-makers: Marcel Bruckner
---

# The household is a group

## Context and Problem Statement

Listing the people in no group ([#50](https://github.com/Marceltov/freundebuch/issues/50)) always named the partner: the other user's own person belongs to the household, not to Freunde or Familie. A first version left them out with a `household` flag on each person in every list that filters by group, which spread one exception over the `people` tool, its `next`, and the Leute chip.

## Considered Options

* **Leave the partner out wherever groups are counted**: a check in every such read path.
* **A household group** (chosen): everyone who signs in is in one group, Haushalt, so the partner is in a group like anyone else.

## Decision Outcome

Chosen option: a household group.

* Migration 009 marks one group `household` (a group already called Haushalt, else a new one, seeded so both users see it) and puts every user's own person in it, shared. A user signing in for the first time joins it.
* It may be renamed ("Herziis") and get other names; the old name stays as another name.
* It can't be deleted, merged into another group, or emptied of someone who signs in; other people may come and go. The settings page offers neither delete nor merging it away.
* `people` with `withoutGroup` and the **Ohne Gruppe** chip are plain filters on group membership.

### Consequences

* Good, because the exception lives in one place, the group's rules, and every list treats the partner like anyone else.
* Good, because the household shows as a group: its members, its traits, its name in your own words.
* Bad, because one group behaves differently from the others, and its rules have to be kept in `groups.ts`.
