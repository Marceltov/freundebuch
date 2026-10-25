---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# Groups: who sees one, how a name finds one, who may change one

## Context and Problem Statement

Groups (Freunde, Familie, Arbeit, Uni …) group people, a person in any number of them. Both users of a household use them, and Claude creates them while filing rambles, so the same group shows up under different names ("Arbeit", "Kollegen"). Memberships already carry their own visibility (ADR 0002); the group itself, its name and its other names did not, so a group made only through one user's private memberships would show its name, and its count, to the other user.

## Considered Options

* **Group names are global and unique; private memberships only hide the member.** Simple, but the name of a group made in private ("Therapie") is visible to the partner, and typing that name would land the partner in it.
* **Groups visible by membership, names not unique across the household.** (chosen)
* **Groups per user.** No leak, but the household loses the shared Familie and every group exists twice.

## Decision Outcome

Chosen option: "Groups visible by membership, names not unique across the household", because it keeps shared groups shared and private ones private with the same rule as everything else.

* A group exists for a viewer when every household starts with it (`seeded`: Freunde, Familie, Arbeit), the viewer made it (`created_by`), or it has a membership the viewer may see. `visibleGroups()` in `backend/visibility.ts` is that rule; every read of `groups` goes through it, including counts and name resolution.
* A typed name finds a visible group by its name or one of its other names (`group_aliases`), compared with `norm()` like person names. Otherwise the viewer gets a new group of their own. So two groups may share a name when one is hidden from the viewer; the user who sees both can merge them.
* Names and other names are shared like person names: either user may rename (the old name stays as another name), add or drop other names, and merge groups they see. A name or other name that already means another visible group is refused: merge instead.
* Deleting a group removes the viewer's own memberships; the group stays while the partner still has some. Taking someone out of a group removes the viewer's membership and the partner's shared one (a correction either may make, like marking a promise done), never the partner's private one.

### Consequences

* Good, because the partner learns nothing from private memberships: no name, no count, no existence, and typing a hidden group's name doesn't reveal it.
* Migration 002 folds existing groups whose names differ only in case or spacing into the oldest one, since names are compared normalised from then on.
* Bad, because a user who first files "Uni" privately and whose partner later files "Uni" as shared ends up seeing two "Uni" groups until they merge them.
