---
status: accepted
date: 2026-10-25
decision-makers: Marcel Bruckner
---

# Social media comes in through shared screenshots, read by Claude

## Context and Problem Statement

The user wants freundebuch to know what is going on in friends' lives as they post it (trips, festivals, new jobs), not only what the user tells it. The friends are on Instagram, LinkedIn and elsewhere, with a mix of public and private accounts. The two household members use an iPhone and an Android phone. How does that information get in?

## Considered Options

* **The platforms' APIs.** Instagram's Graph API covers only one's own business or creator account (the personal Basic Display API was shut down in December 2024); LinkedIn gives no access to other people's activity. Not possible.
* **Scraping with the user's own login** (Instaloader and the like). Sees private accounts too, but is the automated access the platforms detect, and the account at risk is the user's own.
* **Alternative frontends** (Picuki, Imginn, a self-hosted Bibliogram). Only public accounts, and they break whenever the platform blocks them.
* **The user shares a screenshot, and Claude reads it.** (chosen) One tap more than nothing, but it works for every account and every app.

## Decision Outcome

Chosen option: screenshots, because it is the only one that covers private accounts without risking the user's account.

* `POST /api/share` takes an image. Android: the installed web app is a share target (`app/manifest.ts`); a service worker (`public/sw.js`) catches the share and hands it to `/teilen`, which uploads it with the sign-in cookie, so no cross-site POST has to carry the cookie. iPhone: web apps can't be share targets, so an Apple Shortcut posts the image.
* The Shortcut needs a credential that lasts. Access tokens live an hour and ADR 0003 deliberately has no API keys. A **share key** (`fbs_…`, per user, only its sha256 stored, replaced or revoked from the settings) is accepted only by `POST /api/share`: it can hand in a screenshot and do nothing else, read nothing. That keeps it out of the "second way into the data" ADR 0003 rejected.
* Claude (the API key of ADR 0006) reads the image through one forced tool call. It gets the names and other names of everyone in freundebuch, which both users share anyway, and picks a person id only when certain. freundebuch, not Claude, decides: a reading is filed only when every person in it is a known id and nothing is sensitive. Otherwise it waits for the sharing user under "Zu prüfen", with a push. Each screenshot counts against the chat's daily limit.
* What is read becomes a fact (`facts.source`, `happened_on`, `screenshot_id`), so briefings, the person's page, corrections and privacy work as for any fact. Shared by default, like everything else filed; private when the user says so on the check page. A screenshot that waits belongs only to its user; its image is served to the partner only through a fact they may see.
* Images are shrunk to 1080 px WebP and kept in a blob store: files under `DATA_DIR` (default) or an S3-compatible bucket (`FREUNDEBUCH_STORAGE=s3`). The bucket stays private; freundebuch serves every image after the visibility check, never by a direct or presigned link.

### Consequences

* Good, because it works for every platform and every account the user can see, and needs nothing from the platforms.
* Good, because a reading never files on a guessed person: unsure goes to the user.
* Bad, because it is a tap (and a screenshot) per post, not automatic.
* Bad, because the screenshots of other people's posts are sent to the Claude API and stored, as the user's own photos of them would be.
* Bad, because the share key is a credential that ADR 0003's single revocation (rotating the secret) doesn't end; it is revoked on its own, from the settings.
