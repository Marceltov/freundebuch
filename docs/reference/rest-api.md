# REST API

The MCP tools and the web app share the same domain functions, and they are available over REST at `${PUBLIC_URL}/api/v1` as well.

## Authentication

Use one of:

- an OAuth access token issued for the resource `${PUBLIC_URL}/api/v1` (tokens issued for `/mcp` are not accepted here, and the other way round), or
- from the instance's own pages, the sign-in cookie. Requests with the cookie must send a matching `Origin` header.

## OpenAPI

The OpenAPI description is generated from the route table and served at `/api/v1/openapi.json` (sign-in required). The same file is committed as [`openapi.json`](https://github.com/Marceltov/freundebuch/blob/main/openapi.json) in the repository.

## Example

```bash
curl -H "Authorization: Bearer $TOKEN" https://freundebuch.example.com/api/v1/people
```

The same privacy rules apply as everywhere else: a request sees what the token's person may see.

## Calendar feed

`POST /api/v1/me/calendar-feed` makes the caller's [calendar feed](../using/calendar.md) URL (and replaces an older one), `DELETE` turns it off, `GET` says whether there is one. The feed itself is served at `${PUBLIC_URL}/api/calendar/{key}.ics` without a sign-in: the key in the URL is the credential ([ADR 0008](../adr/0008-calendar-feed-through-a-secret-url.md)).

## Roles, situations, traits and gender

- `PATCH /api/v1/people/{id}` takes `{ name?, gender?, look? }`; `gender` is `female`, `male`, `nonbinary` or `null`; `look` is every part of the avatar (see the `Look` schema) or `null`. A person and the briefing carry `look`.
- `POST /api/v1/items/facts/{id}/relationship` with `{ from, to, label, inverse, note? }` turns a fact into a relationship and deletes the fact; `from` and `to` take a person id, `"me"` or `"us"`. It answers `201 { ids }`.
- `PATCH /api/v1/items/facts/{id}` with `{ patch: { kind, checkAfter } }` moves a fact between lasting, situation, need and personality.
- `GET /api/v1/traits?people=<ids>&groups=<ids>` (comma-separated) gives what each person needs and how they are, each once; a group stands for the members the caller sees.
- A relationship has no type: `label` is what `from` is to `to`, `inverse` what `to` is to `from`, in words ("Vermieterin", "Mieter"). `PATCH /api/v1/items/relationships/{id}` with `{ patch: { label, inverse, note } }` changes them.
- `POST /api/v1/rambles` takes `kind` and `checkAfter` on facts (news about a situation must give a new `checkAfter`), `gender` on people, and `"me"` / `"us"` as a relationship's end. A fact's `kind` may also be `need` or `personality` (no `checkAfter`). The briefing has `roles`, `situations`, `traits`, `known` and `network`; `/due` has items of kind `situation`.

## Shared files

- `POST /api/share` takes a file (image, PDF, plain text up to 1 MB) as the body or as the form field `file`, with the session cookie or a share key (`Authorization: Bearer fbs_…`). It answers `202 { id, status, duplicate, message, url }`; `url` is where the file waits under Prüfen.
- `GET /api/v1/files` lists the caller's waiting files: `{ id, status, url, type, summary, transcript, people, error }`. `POST /api/v1/files/{id}/done` closes one with nothing to file and `DELETE …` throws it away (both delete it); `POST …/retry` reads a failed one again. `GET /api/files/{id}` is the file itself, while it waits.
- `POST /api/v1/rambles` takes `fileIds`: their transcripts are added to the ramble's, and the files are deleted.
- Since 0.4 these are `files`, not `screenshots`, and `…/resolve` is gone: filing happens with Claude.

## Rambles and the journal

- `POST /api/v1/rambles` files a ramble and its parts, as the MCP tool `record` does: `conversations`, `journal` (`{ date?, text, mentions?, shared? }`, private unless `shared`) and the item lists, each item with an optional `in` (the index of its conversation). It answers `201` with the ramble's id, each part's id and link, and what was filed. It replaces `POST /api/v1/conversations` (removed in 0.4); reading conversations is unchanged.
- `DELETE /api/v1/rambles/{id}` deletes a ramble with its transcript, conversations, journal entries and items; only its recorder may (403 for the other user).
- `GET /api/v1/journal?from=&to=&personId=` lists journal entries, the last 30 days by default: the caller's own and the ones the other user shared.
- `GET /api/v1/me/reflection` and `PUT` with `{ reflection: { day, hour } | null }` read and set the weekly reflection (day 0 = Sunday, in the server's time zone); `null` turns it off, the default.
- Journal entries are changed through `/api/v1/items/journal_entries/{id}` like other items: `PATCH` its `text`, `date` or `visibility` and `DELETE` it, its writer only.

## Experiences, series and places

- `POST /api/v1/rambles` takes `experiences` (`{ date?, kind, title, summary?, place?, present?, series?, private? }`; `series` is an id or `{ name, rhythmDays?, startsOn?, endsOn? }`) and, on a conversation, `place` and `at` (the index of the experience it happened at). A `place` is a name, `{ id }`, or `{ name, confirmedNew: true }`; a name close to an existing place is refused as ambiguous (409). The object forms may add `in` (the place it sits inside, in the same forms), `address`, `owners` (people by index, `"me"` or `"us"`) and `ownersPrivate`.
- `GET /api/v1/experiences?from=&to=&kind=&placeId=&seriesId=&personId=` lists experiences, with the kinds and series in use. `GET /api/v1/series/{id}` is a series with its sessions, skipped days and the latest missed one; `GET /api/v1/places/{id}` a place with where it sits, its address, whose home it is, the places inside it and everything at it or inside it; `GET /api/v1/places` takes exactly one of `q` (find by name), `person` (the places of a person, with `times` and `last`) or `inside` (the places inside a place).
- Experiences and series are changed through `/api/v1/items/experiences/{id}` and `/api/v1/items/series/{id}` like other items (`PATCH` a field or `visibility`, `DELETE`), their recorder only; a series ends with `{ patch: { endsOn } }`. `/due` has items of kind `session`: a missed session day of a series.
- A conversation has `placeId` next to `place` (the place's name) since 0.5.
