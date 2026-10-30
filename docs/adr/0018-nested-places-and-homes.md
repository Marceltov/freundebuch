---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# Places nest, have an address in words and can be someone's home

## Context and Problem Statement

A place was a name with other names ([ADR 0016](0016-experiences-series-and-places.md)). The user tells where things happened the way people talk: "the festival was in Nürnberg", "we cooked at Anna's", "the Olympiahalle in München", and wants to ask "where were we with Anna?", "what did we do in München?" or "where does Anna live?" ([#78](https://github.com/Marceltov/freundebuch/issues/78)). The issue first asked for addresses and a map.

## Considered Options

* **One "inside" link per place, an address in words, and owners** (chosen).
* **General links between places with a kind** (inside, near, same trip).
* **The city as text on each place.**
* **Coordinates and a map**, with geocoding.

## Decision Outcome

Chosen option: one "inside" link, an address in words, and owners.

* A place may sit inside one other place, as deep as the user said and never more; a loop is refused. Asking about a place includes everything inside it.
* A place may have an address in words, as told.
* A place may be someone's home (`place_owners`). Whose home it is can be told in confidence, so an ownership carries a visibility and its recorder like any item, and goes through `visible()`; each user files their own. A person's address is the address of their home, never a fact of its own. An ownership told in a ramble goes when that ramble is deleted.
* **Visibility goes upward only.** A place is visible through a part at it, through an ownership the viewer may see, or because a visible place sits inside it: who sees the Olympiahalle may know it is in München. A place inside one the viewer sees is listed, counted or found only when it is visible itself, so a private evening at the Olympiahalle never shows on München's page for the partner.
* **A private context writes nothing onto a place the other user sees.** A private part can't give such a place an address or a parent (refused, so Claude asks), merging a private place into one they see leaves its names, address and parent behind, and `place_parent` won't put a place they see inside one they don't.
* **No map, no coordinates, no geocoding.** The web UI stays minimal, a map would need tiles and a geocoder from outside or a large self-hosted set ([V6](../values.md#v6-self-hosting-has-everything)), and tools that track where you have been already exist. What is kept in words can be geocoded later.

### Consequences

* Good, because "near" falls out of what exists: places side by side under one parent, and conversations that point to the experience they happened at.
* Good, because general links can still be added beside the one parent link, without changing it.
* Bad, because a parent named by the partner only in private parts isn't reused: the other user's "München" is made again, as other places are, until merged.
* Bad, because a parent named in a shared part shows its name to the partner even if the user was there privately before; the part said it.
