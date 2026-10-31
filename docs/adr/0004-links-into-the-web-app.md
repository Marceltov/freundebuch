---
status: accepted
date: 2026-10-24
decision-makers: Marcel Bruckner
---

# Links into the web app: paths from the domain, made absolute at the edge

## Context and Problem Statement

Capture happens in Claude, but looking at what was filed happens in the web app. Claude had only ids, so it couldn't hand the user a link to the person or conversation it just recorded. Every person, conversation and item in a tool result should carry a `url` the user can tap. An item has no page of its own, so its link has to land on its row on a page that shows it.

The absolute URL depends on the request (`PUBLIC_URL`, or the request's host behind a trusted proxy), while the domain in `backend/` is called in-process by the pages and knows nothing about requests.

## Considered Options

* **The edges build every URL from the ids in a result.** The domain stays untouched, but each edge would need to know every result shape, and MCP and REST would each carry a copy of that mapping.
* **The domain returns paths; the edges make every `url` absolute.** (chosen)
* **A detail page per item.** One more page per item kind, duplicating the actions the friend page already offers, for items that are one line of text.

## Decision Outcome

Chosen option: "The domain returns paths; the edges make every `url` absolute", because the domain is the one place that knows which page shows an item, and the edges only need one generic step.

* `backend/core/urls.ts` owns the path scheme: `personPath()`, `conversationPath()`, and `itemPath()` with the row anchor from `anchorId()`, which the pages use for the row's element id. Pages and links can't drift apart.
* Domain results carry relative `url`s; the pages use them as they are. `mcp.ts` and the REST dispatcher run `absoluteUrls(publicUrl(headers), body)` just before a result leaves.
* An item links to the page it was read from: in a briefing or `whats_due`, the person's page; in a conversation, the conversation's page, which lists everything filed from it, done and outdated items too. The page that returned an item always shows it, so a link never lands on nothing.
* A link reveals nothing on its own: it only names what the viewer could already see, and opening it runs the page's own `visible()` reads.

### Consequences

* Good, because a new read only adds `url: …Path(id)` where it builds its result; both surfaces pick it up.
* Bad, because `absoluteUrls` rewrites any field named `url` that starts with `/`, so a future field of that name meant as a plain path would be rewritten too.
