# MCP tools

The MCP endpoint is `POST ${PUBLIC_URL}/mcp`: stateless, protocol version 2026-07-28. Every call carries the signed-in person's access token, and every tool acts as that person. Privacy is decided by the server, never by Claude.

| Tool | Kind | What it does |
| --- | --- | --- |
| `record_conversation` | write | Files a conversation: the verbatim transcript, a summary, who was there or mentioned, and the facts, promises, exchanges, dates and relationships learned. A fact is `lasting` or a `situation` with a `checkAfter` day; a relationship says in words what each end is (`label`, `inverse`) and may go to `"me"` or `"us"` (a role: "our landlady"); a new person may get a gender. |
| `remember` | write | Files a fact, a date (a birthday), a promise, a gift idea or a person's gender about people already in the book, without a conversation. Facts take `kind` and `checkAfter` as in `record_conversation`. |
| `find_person` | read | Finds people by name or alias, tolerant of spelling, with context to tell namesakes apart. Claude calls it before referring to anyone. |
| `briefing` | read | Everything worth knowing about one person before you meet them: who they are to you (`roles`, read from your side: `us`, `me` or `partner`), what is going on (`situations`, with `nudge` once their `checkAfter` has come), what stays true (`known`), the one-hop `network`, and a suggested check-in interval. |
| `whats_due` | read | Upcoming dates, promises with a due date, overdue people and situations to ask about (`situation`); 14 days ahead by default. |
| `relate` | write | Records a relationship between two people, or between a person and `"me"` / `"us"` (a role: "our landlady", "my doctor"), or puts people in a group, outside of a conversation. The same relationship again, either way round or in another gender form, files nothing new. A group name finds an existing group by its name or another name (Kollegen → Arbeit). |
| `groups` | read | Every group you see, with its other names and how many people are in it. Claude calls it before putting someone in a group. |
| `set_interval` | write | Saves how often you want to see a person, in days, or none. |
| `correct` | destructive | Marks done or outdated, edits (including a conversation's date and a relationship's words), deletes, changes visibility, renames, adds an alias, sets a person's gender (and returns their relationships to put in it), turns a fact into a relationship (`to_relationship`), merges duplicates, shares a transcript; `edit` with `{ kind, checkAfter }` moves a fact between lasting and situation; takes someone out of a group, renames, merges or deletes a group and adds or drops its other names. |
| `get_transcript` | read | The verbatim ramble a conversation was recorded from. |
| `calendar_feed` | destructive | Gives you the secret URL of your [calendar feed](../using/calendar.md), making one when you have none; replaces or revokes it, which ends the old URL. Not in the in-app chat. |

## What a result tells Claude

Every tool result carries `next`: short instructions, built by the server from what this call did, that Claude follows before it answers you. It is empty when there is nothing to do. See [ADR 0010](../adr/0010-tool-results-tell-claude-what-to-do-next.md).

| Tool | What `next` says |
| --- | --- |
| `record_conversation` | Read back what was filed, with the day it happened and the link; who is new in the book; each situation's day, and that it is the six-week default when Claude gave none; a relationship that was already there and was kept; people who were in a group already. |
| `remember` | Each situation's day, and whether it is the default; for a gender it sets, which word of which relationship to put in it, as with `correct`. |
| `relate` | A relationship that was already there (either way round, or in another gender form) and was kept; people who were in the group already. |
| `correct` | `outdated` on a situation: file how it ended as a lasting fact, if worth keeping. `edit` that makes a fact a situation or changes its day: the day. `merge`: what moved, and to look the person over for anything doubled. `gender`: which word of which relationship to put in the new gender. `to_relationship`: a relationship that was already there. |
| `find_person` | None found: ask whether this is someone new, then `record_conversation`. Several: ask which one, with the context that tells them apart. |
| `briefing` | Lead with the role ("Vermieterin of you both"); ask about each nudging situation first; say where a fact from a screenshot comes from; offer the suggested interval. |
| `whats_due` | Suggest asking about each due situation. |
| `calendar_feed` | Give the URL only to you; an existing feed can't be shown again, so offer `replace`; a replaced or revoked URL has stopped working. |
| `get_transcript` | A transcript private to whoever recorded it: answer from the summary. |
| `set_interval`, `groups` | Nothing. |

The write tools also return what they filed (`filed` for `record_conversation` and `remember`, `relationships` for `relate` and `to_relationship`): each item with its id and link, each situation's `checkAfter` and `defaultCheckAfter`, and whether each relationship was new (`created`). `next` and these details are built only from what you may see: the other user's private items never show, not even in a count.

The server also sends Claude instructions with the connection, for what it needs to know before a call. In short:

- pass the ramble verbatim as the transcript,
- ask before filing anything sensitive as shared,
- resolve every person with `find_person` and ask when a name is ambiguous,
- follow the `next` of every result,
- take the day the user names ("vorgestern") as the conversation's date, and fix the date with `correct` when it was wrong,
- give you the link whenever you may want to look at something in the web app,
- prefer an existing group over a new one, and ask before creating one,
- file who someone is to you as a relationship to `"us"` or `"me"`, never as a fact, saying in German words what each end is,
- file what is going on as a situation with an estimated `checkAfter`; agree a new day with you when there is news.

Every person, conversation and item in a tool result carries a `url` into the web app, built from `PUBLIC_URL` (or the request's host when it is unset). A person opens their page, a conversation its page. An item opens the page that shows it with its row highlighted: in a briefing or `whats_due` that is the person's page, in a conversation the conversation's page, which also lists done and outdated items. The REST API returns the same fields.

The exact input and output schemas are served by the endpoint itself (`tools/list`).

## Roles, situations and gender

- **Relationships in words.** There is no list of types. Each relationship says what `from` is to `to` (`label`) and what `to` is to `from` (`inverse`), in German and in each one's gender: Anna and her son Tom are `label` Mutter, `inverse` Sohn. The same words again, either way round or in another gender form ("Vermieter:in", "Vermieterin"), are the same relationship.
- **Roles.** "She's our landlady" is from her to `"us"`, `label` Vermieterin, `inverse` Mieter:in: one relationship per household member, each kept once. A briefing reads it from your side: "Unsere Vermieterin" only when you see it to both of you, else "von dir" or "von Sybille". See [ADR 0009](../adr/0009-household-members-in-the-relationship-graph.md).
- **Situations.** Moving, a new dog, looking for a car: a situation with a `checkAfter` day, estimated from how long it usually takes (six weeks when Claude gives none); the result's `next` has Claude tell you the day. News supersedes it and needs a new day, which Claude suggests and agrees with you; once it has passed, the situation nudges in the briefing, in `whats_due`, on Start and in the daily notification, until you tell Claude how it went. Then it is marked outdated, and `next` asks Claude to file the outcome as a lasting fact. Situations never disappear on their own.
- **Gender.** `female`, `male`, `nonbinary`, or none: only when you say it or use a pronoun for the person, never guessed from the name. Claude writes the words in it ("Vermieterin", "Vermieter", "Vermieter:in" when unknown); setting it returns the relationships whose word for the person may need it (a first gender: only words still neutral, like "Vermieter:in" or "Kind"; a changed one: all of them), each once, and `next` tells Claude which word of each to put in the new gender.
