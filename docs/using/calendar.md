# Calendar

freundebuch can put the birthdays and other dates you've filed into your calendar: Google Calendar, Apple Calendar, Outlook, or any app that subscribes to a calendar by URL.

## What's in it

- Every **birthday**, every year. With the age when the year is known ("🎂 Anna wird 36"), without it otherwise. A birthday on 29 February shows on 28 February outside leap years.
- The **other dates**: anniversaries and anything else with a date, yearly or once.
- Your own open **promises** with a due date, on the day they are due.

Everything is a whole-day event that doesn't mark you as busy, and each one links to the person in freundebuch.

The feed is read as you: your partner's private items are never in it. Your own private dates are, because it is your calendar.

## Getting the address

Ask Claude for it ("Gib mir meinen Kalender-Link"), or open **Einstellungen → Kalender abonnieren** and tap **Adresse erzeugen**. The address is shown only once; freundebuch keeps nothing it could show you again. If you lose it, make a new one.

Treat the address like a password: anyone who has it can read these dates without signing in.

## Subscribing

- **Google Calendar**: on a computer, open [calendar.google.com](https://calendar.google.com), click **+** next to **Weitere Kalender** → **Per URL**, paste the address. It then shows on your phone too.
- **iPhone, Mac**: in Einstellungen, tap **In der Kalender-App öffnen**, or add it under **Kalender → Accounts → Abonnierte Kalender**.
- Other apps: look for "subscribe by URL" or "Internet calendar".

!!! note "Google is slow"
    Google Calendar fetches a subscribed calendar only every few hours, sometimes once a day, and there is no button to make it fetch now. A birthday you file today may show up tomorrow. Apple Calendar lets you choose how often it fetches.

## Replacing or ending it

**Neue Adresse erzeugen** makes a new address; **Abo beenden** turns the feed off. Either way the old address stops working at once, and a calendar subscribed to it goes empty: subscribe again with the new one. Claude can do both too, and asks first.

The design decision is in [ADR 0008](../adr/0008-calendar-feed-through-a-secret-url.md).
