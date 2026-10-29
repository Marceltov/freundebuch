# Notifications

freundebuch can remind you every day about:

- birthdays and other dates, today and tomorrow (with the age, when the year is known),
- promises due today or tomorrow,
- people you're overdue to see,
- situations to ask about ("💬 Frag mal nach: Jonas – sucht ein Auto").

Once a week, if you turn it on, the same address also gets a short [reflection on your journal](journal.md#weekly-reflection).

Notifications are optional, and each person sets their own. You only ever get your own reminders: your partner's private items never show up in yours.

## Set up a webhook

1. Open the web app, tap the gear icon (**Einstellungen**).
2. Enter a webhook URL, for example an [ntfy](https://ntfy.sh) topic: `https://ntfy.sh/some-long-unguessable-topic`. A self-hosted ntfy works the same way.
3. Tap **Test senden**. You should get "🔔 freundebuch-Test".

The reminders go out once a day after `FREUNDEBUCH_NOTIFY_AT` (08:00 by default, in the instance's `TZ`).

!!! note "Keep the URL secret"
    With ntfy, the topic name is the password: anyone who knows it can read your reminders. Use a long random name, or a topic that requires an access token on your own ntfy server.

## The format

Each reminder is one HTTP `POST` in ntfy's format, so any service that accepts that works:

| Part | Content |
| --- | --- |
| Body | Details, e.g. "Zuletzt am 2026-07-14" (plain text, UTF-8) |
| `Title` header | The reminder, e.g. "🎂 Anna Weber hat morgen Geburtstag (34)" (non-ASCII as RFC 2047) |
| `Tags` header | An ntfy emoji tag such as `birthday` or `pushpin` |
| `Click` header | The person's page, when `PUBLIC_URL` is set |

At most 10 messages go out per day; the last one says how many more there are ("+3 weitere"). Each person gets one round per day: a message the webhook doesn't take (anything but 2xx) is logged and not sent again, and a restart never sends a day's reminders twice. Redirects are not followed.
