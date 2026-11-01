---
status: accepted
date: 2026-10-30
decision-makers: Marcel Bruckner
---

# A language per user, German or English

## Context and Problem Statement

freundebuch spoke only German: the web app, the notifications and what Claude wrote for the app (the chat's answers, the weekly reflection, the pre-read of a shared file). A household that doesn't speak German couldn't keep its book ([#72](https://github.com/Marceltov/freundebuch/issues/72), [V1](../values.md#v1-a-book-for-the-people-who-keep-it)). The copy was one German object read as a module constant in about fifty files, in server and client components alike.

## Considered Options

* **A language per user, stored with the user, read per request** (chosen).
* **A language per instance**, from an environment variable or a household setting.
* **The browser's language on every request**, nothing stored.

## Decision Outcome

Chosen option: a language per user, `users.language` (`de` or `en`, German by default), set in Einstellungen (`PUT /api/v1/me/language`).

* **The copy is a dictionary per language with the same keys.** `components/copy.ts` has `de` and `en: Copy`, where `Copy` is the type of the German one, so a key missing in English doesn't compile; `backend/notify/copy.ts` does the same for the notifications. Adding a language is adding a dictionary.
* **Server components read it per request, client components from a context.** `pageViewer()` puts the viewer's language in a per-request store (React `cache`, `components/serverCopy.ts`), and server components call `getCopy()` after it; signed-out pages take the browser's `Accept-Language`. The root layout hands the language to `LanguageProvider`, and client components call `useCopy()`. A component drawn on both sides (Face) is a client component. Formatting (`components/format.ts`) takes the copy, whose `locale` it formats dates in.
* **Everything that speaks to one user follows their language**: reminders, the calendar feed, the Shortcut's answers, the weekly reflection, the pre-read of a file they shared, and the chat's answers (its system prompt names the language).
* **What is filed keeps its words.** Relationship labels, experience kinds and summaries are data, in the words they were filed in; Claude is told to use the user's language for them, not German. Nothing is translated after the fact.
* **The language is a UI preference, not data about people**, so it has no MCP tool: over MCP the user talks to Claude in whatever language they like.

### Consequences

* Good, because each of a household's two users can have their own language, and a hosted freundebuch ([#69](https://github.com/Marceltov/freundebuch/issues/69)) needs nothing more.
* Good, because the compiler finds every untranslated string.
* Bad, because a server component reads the language from a request store that `pageViewer()` fills: a page that reads `getCopy()` before resolving its viewer would show German. The e2e tests run a page in English to catch it.
* Bad, because a household where each speaks another language files its data in two languages.

## More Information

A language per instance was simpler (a module constant) but would have to move to the request once there are several households, and couldn't serve two users with different languages. The browser's language alone changes with the device and can't reach notifications, which have no browser.
