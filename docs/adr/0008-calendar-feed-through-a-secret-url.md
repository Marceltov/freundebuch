---
status: accepted
date: 2026-10-26
decision-makers: Marcel Bruckner
---

# The calendar feed is reached by a secret URL

## Context and Problem Statement

Birthdays and other dates in freundebuch should show up in the calendar the user already looks at: Google Calendar (Gmail) on both phones, or any other calendar app. Calendar apps subscribe to an ICS feed by URL and fetch it themselves, every few hours, from their own servers. Google Calendar can't sign in for that fetch: no OAuth, no cookie, no custom header. ADR 0003 deliberately gives freundebuch no API keys or passwords, only authentik sign-in and freundebuch's own OAuth tokens. How does a calendar app get the feed?

## Considered Options

* **No feed; the daily push only** (notifications, already there). Nothing to subscribe to; the dates stay out of the calendar.
* **Download an .ics file from the web app** and import it. A snapshot: a birthday filed later never arrives, a corrected one stays wrong.
* **A feed behind OAuth or HTTP Basic.** Google Calendar supports neither for subscriptions.
* **A secret URL per user** (chosen): `/api/calendar/fbc_….ics`, the key in the path, read as that user.

## Decision Outcome

Chosen option: a secret URL, because it is the only way Google Calendar can subscribe at all.

* Like the share key of ADR 0007, the **calendar key** (`fbc_…`, 32 random bytes) is per user, and only its sha256 is stored (`user_settings.calendar_key_hash`). It is shown once, when it is made: from Einstellungen, `POST /api/v1/me/calendar-feed`, or the MCP tool `calendar_feed`. A new key replaces the old one; revoking it turns the feed off. Both end the old URL at once.
* The key can do one thing: read that user's feed. It is not accepted anywhere else, so it isn't the general second way into the data that ADR 0003 rejected.
* The feed is read as the key's user, through `visible()`: their dates and the partner's shared ones, and the user's own open promises with a due date (as in `whats_due`). The partner's private items are left out entirely, with no busy slot or placeholder. The user's own private dates are in it, because it is their calendar.
* Whole-day events only (dates in freundebuch have no time or time zone). A yearly date is written out year by year, from last year to five years ahead, so a birthday with a year can say the age. Each event links to the person's page (ADR 0004); the link still needs a sign-in to open.
* The MCP tool gives Claude the URL so the user can ask for "my calendar link". The in-app chat doesn't get the tool: its links are paths, and Einstellungen shows the feed there.

### Consequences

* Good, because birthdays appear in the calendar the user already uses, with nothing to install.
* Good, because a revoked or replaced URL stops working at once, and a leaked one reveals only names and dates, never conversations or facts.
* Bad, because anyone who has the URL can read the dates in it without signing in. It ends up in Google's servers, in a reverse proxy's access log if that logs paths, and, when asked for over MCP, in the conversation with Claude.
* Bad, because, like the share key, the calendar key is a credential that ADR 0003's single revocation (rotating the secret) doesn't end; it is revoked on its own.
* Bad, because Google refreshes a subscribed feed only every few hours to once a day: a birthday filed now may show up tomorrow.
