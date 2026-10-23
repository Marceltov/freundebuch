---
hide:
  - navigation
  - toc
---

<div class="fb-hero" markdown>

# Remember what's going on with your friends.

<p class="fb-hero__lead">freundebuch is a personal CRM for one household. After you meet someone, you ramble about it to Claude. freundebuch keeps the transcript, the news and the promises, and briefs you before you see them again.</p>

[Get started](getting-started.md){ .md-button .md-button--primary }
[How rambling works](using/rambling.md){ .md-button }

</div>

## Why

You meet a friend and can't remember whether her new job started yet, what her kid is called, or that you promised to send her a contact. freundebuch is for that moment: nothing to type in, a briefing when you need it.

- **Capture by talking.** You tell the Claude app (by voice or text) how the dinner went. Claude files it through freundebuch's built-in MCP endpoint: who was there, what's new, what you promised, gift ideas, birthdays, who is related to whom.
- **Briefings.** "I'm seeing Sarah tomorrow, what's new?" gives you the last meetings, current facts, open promises and upcoming dates.
- **Who's overdue.** Each person can have a check-in interval. The start page puts people you haven't seen for too long on the outer rings.
- **Reminders.** Birthdays, anniversaries, promises and overdue friends, once a day to a webhook such as [ntfy](https://ntfy.sh).
- **Shared, with private parts.** Two people in a household share one freundebuch. Anything said in confidence can be private to whoever recorded it, down to a single fact, and Claude asks when something sounds sensitive.

<div class="fb-shots" markdown>
![The orbit: you in the middle, friends on rings by how long ago you saw them](assets/orbit.png)
![A friend's page: news, promises, gift ideas, dates and the people around them](assets/friend.png)
</div>

The web app is in German and meant for looking things up on the phone. Everything you add goes through Claude.

## What it is not

- Not a contact book: no phone numbers or addresses to maintain.
- Not multi-tenant: one instance per household, everyone signs in through your own identity provider (authentik).
- Not a form-filling app: the UI only reads, plus a few quick actions (done, share, delete).

freundebuch is a Next.js app with SQLite: one container, one data file. It's licensed AGPL-3.0-only.
