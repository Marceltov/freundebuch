# MCP tools

The MCP endpoint is `POST ${PUBLIC_URL}/mcp`: stateless, protocol version 2026-07-28. Every call carries the signed-in person's access token, and every tool acts as that person. Privacy is decided by the server, never by Claude.

| Tool | Kind | What it does |
| --- | --- | --- |
| `record_conversation` | write | Files a conversation: the verbatim transcript, a summary, who was there or mentioned, and the facts, promises, exchanges, dates and relationships learned. |
| `remember` | write | Files a fact, a date (a birthday), a promise or a gift idea about people already in the book, without a conversation. |
| `find_person` | read | Finds people by name or alias, tolerant of spelling, with context to tell namesakes apart. Claude calls it before referring to anyone. |
| `briefing` | read | Everything worth knowing about one person before you meet them, including a suggested check-in interval. |
| `whats_due` | read | Upcoming dates, promises with a due date and overdue people; 14 days ahead by default. |
| `relate` | write | Records a relationship between two people, or puts people in a group, outside of a conversation. A group name finds an existing group by its name or another name (Kollegen → Arbeit). |
| `groups` | read | Every group you see, with its other names and how many people are in it. Claude calls it before putting someone in a group. |
| `set_interval` | write | Saves how often you want to see a person, in days, or none. |
| `correct` | destructive | Marks done or outdated, edits (including a conversation's date), deletes, changes visibility, renames, adds an alias, merges duplicates, shares a transcript; takes someone out of a group, renames, merges or deletes a group and adds or drops its other names. |
| `get_transcript` | read | The verbatim ramble a conversation was recorded from. |

The server also sends Claude instructions with the connection. In short:

- pass the ramble verbatim as the transcript,
- ask before filing anything sensitive as shared,
- resolve every person with `find_person` and ask when a name is ambiguous,
- read back what was filed, with the day it happened and the link to the conversation,
- take the day the user names ("vorgestern") as the conversation's date, and fix the date with `correct` when it was wrong,
- give you the link whenever you may want to look at something in the web app,
- offer suggested intervals and save them only once you agree,
- prefer an existing group over a new one, and ask before creating one.

Every person, conversation and item in a tool result carries a `url` into the web app, built from `PUBLIC_URL` (or the request's host when it is unset). A person opens their page, a conversation its page. An item opens the page that shows it with its row highlighted: in a briefing or `whats_due` that is the person's page, in a conversation the conversation's page, which also lists done and outdated items. The REST API returns the same fields.

The exact input and output schemas are served by the endpoint itself (`tools/list`).
