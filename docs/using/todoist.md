# Todoist

Instead of (or as well as) the [daily push](notifications.md), what is due can become tasks in your Todoist, on the day they are due. Each person connects their own Todoist; you only ever get tasks for your own items, never for your partner's private ones.

## Connect

1. Open the web app, tap the gear icon (**Einstellungen**) and find the Todoist section.
2. In Todoist, open **Settings, Integrations, Developer** and copy your API token. Paste it into freundebuch.
3. Choose the project the tasks go into.
4. Under **Zustellung**, choose where your daily items go: the push, Todoist, or both.

!!! note "The token"
    freundebuch keeps the token in its database like the webhook URL. It is never shown again and never logged. Disconnect removes it. If Todoist rejects it later (you revoked it, say), the settings page shows the connection as broken; connect again with a new token. With delivery set to Todoist, items fall back to the push when Todoist can't be used.

## What becomes a task

One task per item, with the same short text as the push: a birthday, an anniversary or another date, a promise, someone you are overdue to see, a situation to ask about, a missed session of a series.

For birthdays, anniversaries, other dates and promises you set separately:

- **Days ahead** (0 to 60): 0 creates the task on the day, 7 a week before.
- **The day** as the task's due date, or as its deadline. With a deadline, the task appears in your Today a number of days ahead and keeps the day as its deadline.

Birthdays default to one day ahead, the rest to the day itself, as due date. Overdue people, situations and missed sessions are created the day they come up.

A task you never tick stays open. When the item is settled in freundebuch first (you filed a conversation, a promise is done), its task is closed for you.

## What a tick does

A tick reaches freundebuch within about five minutes, and always before Claude answers `whats_due` or a briefing.

| Task | On tick |
| --- | --- |
| Birthday, anniversary, other date | Closed, nothing else |
| Promise | The promise is marked done |
| Overdue person, situation, missed session | A follow-up: Claude asks you how it went |

A tick never files anything by itself. A follow-up is only a question waiting for you, private to you. It shows in the nudges list in the web app and in what Claude sees in `whats_due`, in a briefing and after filing something about the person. It ends when you tell Claude about it, or when you say it was just a contact ("correct contact"): then the last-seen date moves to the day you ticked and nothing else is filed.

A situation's follow-up closes only with a new check date you agree to, or when the situation is marked over; if nothing came up, Claude suggests a new check date.

Renaming, moving or deleting a task in Todoist changes nothing in freundebuch.

## Comments

A comment you leave on one of freundebuch's tasks in Todoist (a line of text, a photo, a voice message) comes into **Prüfen**, with the next sync, as if you had shared it: the voice message transcribed by your own Whisper, the photo read like a screenshot. It is dated by the day you wrote the comment and says which task it belongs to ("Kommentar zu „…“ in Todoist"); comments on the same task come together.

When Claude works it through with you, it proposes what the comment means: you were in touch or there is news, so it is filed and that settles the task (which then closes in Todoist); it is only a note, so that is filed and the task stays open; or nothing came of it, so the file is closed. A comment alone never ticks a task or files anything, and freundebuch writes nothing back to Todoist.

Only your own comments count: in a shared Todoist project, a collaborator's comment is left alone. Comments you wrote before this came in were read once, when it was first switched on.
