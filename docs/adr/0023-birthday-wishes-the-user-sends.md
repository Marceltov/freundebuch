---
status: proposed
date: 2026-10-31
decision-makers: Marcel Bruckner
---

# Birthday wishes Claude drafts and the user sends from their own app

## Context and Problem Statement

freundebuch knows when a birthday is near and what is going on in that person's life, so it could help write the wishes ([#71](https://github.com/Marceltov/freundebuch/issues/71)). But it must never contact the people in the book on its own: a message goes out only when the user sends it, through an integration they chose, after they have seen it ([V3](../values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)). It must work over MCP first ([V7](../values.md#v7-ai-native-claude-first)).

## Considered Options

* **Claude drafts with the tool `birthday_message`; links open the user's own app with the text filled in** (chosen).
* **freundebuch sends through a messenger API** (WhatsApp Business, Telegram bot, Signal CLI) once the user approves the draft.
* **A drafts list in the web app**, written by the server's Claude every morning for each birthday.

## Decision Outcome

Chosen option: drafting by Claude and sending by links.

* **`birthday_message`** (MCP, `GET /api/v1/people/{id}/birthday-message`) returns what wishes can be written from: when the birthday is, the age, the roles and what is shared about the person. Called again with the final `text`, it returns `wa.me`, `t.me/share`, `sms:` and `mailto:` links with the text filled in and no recipient. The user picks the person in their app and sends.
* **What a message may draw on is narrower than a briefing.** It goes to the person, so it uses only shared items and nothing in the health category; the viewer's private notes stay out too. Needs and temperament (traits) are for planning around someone, not for saying to them, and are left out.
* **In the web app** the person's page shows "Glückwunsch schreiben" from a week before the birthday, when the chat is on. It opens Erzählen with the request in the field, for the user to send, and the chat shows the links as buttons. The request waits in the field instead of being sent, so nothing happens that the user didn't start.
* **Nothing is stored.** The draft lives in the conversation with Claude; once the user says it is sent, `next` offers to file it with `record` as a message, like any other contact.

### Consequences

* Good, because freundebuch sends nothing and holds no messenger credentials: there is nothing that could send on its own, and nothing to set up.
* Good, because it works with every messenger that takes a share link, and over MCP with any Claude.
* Bad, because the user picks the recipient in their app each time; freundebuch keeps no phone numbers. Own cards ([#70](https://github.com/Marceltov/freundebuch/issues/70)) could later fill the number in (`wa.me/<number>`).
* Bad, because Signal has no share link: there the user copies the text.

## More Information

A messenger API was ruled out because it needs credentials for the user's account on the server and a send path that doesn't need the user's hand on it, which is what V3 rules out; it would also call out to a third party on the user's behalf. Drafts written every morning would spend the API on birthdays nobody writes for, and keep text about the people in the book that the user never asked for.
