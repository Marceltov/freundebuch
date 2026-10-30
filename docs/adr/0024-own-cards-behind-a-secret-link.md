---
status: proposed
date: 2026-10-31
decision-makers: Marcel Bruckner
---

# Own cards: a vCard behind a secret link, fetched once a day

## Context and Problem Statement

What freundebuch knows about someone comes from what the user tells it. Some things the person knows best themselves and changes now and then: their number, their address, their birthday. They could say it themselves, once, for everyone they want to have it ([#70](https://github.com/Marceltov/freundebuch/issues/70)). This must stay the only thing that crosses from one person to another. There is no federation, nobody is told they are in a book, and nothing is synced into other services ([V3](../values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it), [V1](../values.md#v1-a-book-for-each-household)).

## Considered Options

* **A vCard behind a secret link the owner can revoke, subscribed to per person and fetched once a day** (chosen).
* **Federation between instances** (ActivityPub, a freundebuch protocol), where instances find each other and push updates.
* **CardDAV**: publishing into, or reading from, an address book server ([#73](https://github.com/Marceltov/freundebuch/issues/73), parked).

## Decision Outcome

Chosen option: the link, like the calendar feed ([ADR 0008](0008-calendar-feed-through-a-secret-url.md)).

* **The user's own card** (`own_cards`) holds only what they write on it: name, phone, email, address, birthday, note. **Publishing** makes `/api/card/<key>.vcf`, a vCard 4.0 that any contacts app reads too. Only the key's hash is kept; a new key ends the old one, and unpublishing ends it.
* **Subscribing** attaches a card link to a person (`card_subscriptions`, one per person) and fetches it at once, then once a day. A card is shared in the household like the person's name, and either user may attach or remove it ([ADR 0011](0011-either-user-edits-shared-items.md)).
* **A card is the person's own words.** The briefing carries it as `card`, apart from facts; Claude is told never to copy it into facts and to ask when its birthday differs from the filed one.
* **Fetching a typed URL is guarded.** Only `https`, no credentials in the URL, a host that resolves only to public addresses (no loopback, private, link-local or unique-local networks), no redirects, at most 64 KB and 10 s. A failure is kept as a code (`unreachable`, `not_found`, `not_a_card`, `refused`) next to the last good card. The URL is never logged.
* **MCP first**: the tool `cards` (`mine`, `set_mine`, `publish`, `unpublish`, `subscribe`, `unsubscribe`), then REST (`/api/v1/me/card`, `/api/v1/me/card/link`, `/api/v1/people/{id}/card`) and the web app (Einstellungen → Deine Karte, and "Ihre Karte" on a person's page). `cards` stays out of the in-app chat, like `calendar_feed`: the link it makes only works absolute.

### Consequences

* Good, because nothing is pushed and nothing is discovered: a card goes only where its owner sent the link, and the owner can end it.
* Good, because the format is a vCard, readable without freundebuch ([V6](../values.md#v6-self-hosting-has-everything)).
* Bad, because the owner's server sees each subscriber's server fetch the card once a day (its address and the time), as a calendar host does.
* Bad, because a change reaches subscribers within a day, not at once.
* Bad, because DNS is resolved once for the check and again by `fetch`, so a host that answers differently the second time (DNS rebinding) could slip through. Pinning the checked address in the request would close that.

## More Information

Federation was ruled out because it makes instances find and talk to each other, which is exactly the network of books V1 and V3 rule out. CardDAV stays parked: it syncs a whole address book, which is more than one person's own card.
