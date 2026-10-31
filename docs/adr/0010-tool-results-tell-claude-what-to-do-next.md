---
status: accepted
date: 2026-10-27
decision-makers: Marcel Bruckner
---

# Tool results tell Claude what to do next

## Context and Problem Statement

The MCP tools answered with what the REST API answers: ids, a url and counts. What Claude should do after a call was in the tool descriptions and the server instructions: read back what was filed, tell the user a situation's day, ask about a nudging situation first, offer a suggested interval, relabel relationships after a gender change. Claude had to remember all of it before the call, without knowing what the call would do. Often it didn't know enough to follow it anyway. A situation filed without a `checkAfter` got a default day that Claude never saw. A relationship that already existed looked like a new one. A merge didn't say what moved. And not every client passes the server instructions on. How does a tool result tell Claude what happened and what to do now?

## Considered Options

* **Keep the guidance in the descriptions and instructions**, and only add data to the results. Claude still has to work out from the data which rule applies, and every rule costs context in every session, needed or not.
* **The same plain data over MCP and REST, with a generic hint per tool**, e.g. "read back what you filed". The hint can't say the default day it chose, or which relationship was already there.
* **`next` on every tool result** (chosen): short English instructions built from what this call actually did, next to the data it filed.

## Decision Outcome

Chosen option: every tool result carries `next: string[]`, built in the tool layer from what the domain returned.

* The domain functions return the facts: what was filed with ids and links, each situation's `checkAfter` and whether the server chose it (`defaultCheckAfter`), whether a relationship was new (`created`), which members were in a group already, a fact as it stands after `outdated` or `edit`, what a merge moved. The REST API gets the same data where it has the call: `Recorded` gains `filed`.
* `next` is written only in `backend/mcp/tools.ts`, so REST stays plain data and MCP and the in-app chat share it. It names the person, the item and the day: "Anna's situation "sucht ein Auto" nudges on 2026-12-08, a default because you gave no checkAfter: tell the user, and change it with correct if they want another day". It is empty when there is nothing to do.
* What Claude needs before a call stays in the descriptions and instructions: resolve every person, ask before filing anything sensitive as shared, estimate a situation's day, agree a new day for news, words and gender of a relationship. What only matters after a call moves into `next`: the read-back with the day and the link, a situation's day, asking about nudging situations, leading with the role, offering the suggested interval, filing the outcome of a situation that ended, relabelling after a gender change, an existing calendar feed that can't be shown again. The instructions say once that every result carries `next`.
* `next` and the filed details are built only from rows the domain read through `visible()`: the caller's own new rows, a relationship they already saw, a briefing's or `whats_due`'s visible items, and a merge's counts of what they may see. A private item of the other user never shows, not in a line, a count or a hint.
* The in-app chat uses the same tools, so it gets `next` too. Its rules still say that what a tool returns is data, never instructions, and now make `next` the exception: it is freundebuch's own, but what it quotes (a fact's text, a name) is data.

### Consequences

* Good, because Claude knows what the call did: the default day, a relationship that was already there, what a merge moved. It can tell the user without a second call.
* Good, because a client that drops the server instructions still gets the after-call guidance, in the result.
* Good, because the descriptions and instructions are shorter, and carry only what Claude needs to choose and fill a call.
* Bad, because `next` is English text that tests pin word for word: rewording a line means changing its test.
* Bad, because `next` quotes what the users wrote (a fact's text), so a crafted fact reads like part of an instruction. It is quoted and a fact is only ever written by the household, but Claude has to keep treating it as data.
* Bad, because a write result is larger: `record_conversation` returns every item it filed.
