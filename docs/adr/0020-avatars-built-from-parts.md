---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# Avatars are built from parts, chosen by Claude from a description

## Context and Problem Statement

A face in freundebuch was a person's initials on a color of their own. A face that looks a bit like the person is quicker to recognise on the orbit and in lists ([#49](https://github.com/Marceltov/freundebuch/issues/49)). Photos are out: only words are kept ([V4](../values.md#v4-only-words-are-kept)), and a photo of someone is the most personal thing the book could hold about them. The look has to come from words, and over MCP first ([V7](../values.md#v7-ai-native-claude-first)).

## Considered Options

* **An avatar stacked from a small library of drawn SVG parts, the choices stored on the person** (chosen).
* **An image generated from the description** by an image model.
* **A photo**, cropped and stylised.

## Decision Outcome

Chosen option: parts. A look is one value for each of face, skin, hair, hair color, glasses and beard (`LOOK_PARTS` in `backend/core/types.ts`), plus the user's words for it, kept as JSON in `persons.look`.

* **Claude chooses the parts.** The user describes someone ("kurze lockige braune Haare, Brille"); Claude maps it onto the parts and files it with `remember` (`looks`). The schema lists every value; `next` has Claude say which parts it chose and give the link to the person's page, where the user checks it and switches a part by hand ("…" → Aussehen).
* **The description is kept with the choices**, so Claude can choose again when the parts change, and the editor shows what was said.
* **A look is shared like the name and gender**: it is how the person looks, not something one of the household knows about them. Either user may change it ([ADR 0011](0011-either-user-edits-shared-items.md)).
* **Drawing happens in the browser from the choices** (`components/Avatar.tsx`). The app's layout reads every look once and hands it to each face through a context, so no page fetches it on its own. A person without a look, or with a stored look that no longer fits the parts, keeps their initials. The sticker (color, rim, tilt) stays the face's.

### Consequences

* Good, because nothing is kept but words and a few choices ([V4](../values.md#v4-only-words-are-kept)); there is no image to store, generate, pay for or leak.
* Good, because a redrawn part changes every avatar at once, and drawing is instant and works offline.
* Bad, because a handful of parts can't tell everyone apart; the avatar is a hint next to the name, not a likeness.
* Bad, because a new value for a part means a schema change (and a migration when one is dropped: a look that no longer fits falls back to the initials until it is chosen again).

## More Information

Image generation was ruled out because it calls out to a service per avatar, gives a different style each time and makes a picture that has to be kept. A photo breaks V4 outright.
