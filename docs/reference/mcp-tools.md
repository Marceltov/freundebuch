# MCP tools

The MCP endpoint is `POST ${PUBLIC_URL}/mcp`: stateless, protocol version 2026-07-28. Every call carries the signed-in person's access token, and every tool acts as that person. Privacy is decided by the server, never by Claude.

| Tool | Kind | What it does |
| --- | --- | --- |
| `record_conversation` | write | Files a conversation: the verbatim transcript, a summary, who was there or mentioned, and the facts, promises, exchanges, dates and relationships learned. |
| `find_person` | read | Finds people by name or alias, tolerant of spelling, with context to tell namesakes apart. Claude calls it before referring to anyone. |
| `briefing` | read | Everything worth knowing about one person before you meet them, including a suggested check-in interval. |
| `whats_due` | read | Upcoming dates, promises with a due date and overdue people; 14 days ahead by default. |
| `relate` | write | Records a relationship between two people, or puts people in a group, outside of a conversation. |
| `set_interval` | write | Saves how often you want to see a person, in days, or none. |
| `correct` | destructive | Marks done or outdated, edits, deletes, changes visibility, renames, adds an alias, merges duplicates, shares a transcript. |
| `get_transcript` | read | The verbatim ramble a conversation was recorded from. |

The server also sends Claude instructions with the connection. In short:

- pass the ramble verbatim as the transcript,
- ask before filing anything sensitive as shared,
- resolve every person with `find_person` and ask when a name is ambiguous,
- read back what was filed,
- offer suggested intervals and save them only once you agree.

The exact input and output schemas are served by the endpoint itself (`tools/list`).
