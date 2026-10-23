# Private and shared

Two people share one freundebuch, usually a couple. Most of what you learn about mutual friends is meant to be shared: that's the point. Some of it was told in confidence.

## The rules

- **Shared by default.** Everything you record is visible to your partner, unless it's private.
- **Private is per item.** One fact, promise, date, gift idea or relationship can be private while the rest of the conversation stays shared. A whole conversation can be private too.
- **Private means only you.** A private item is visible only to whoever recorded it, everywhere: in pages, Claude's answers, notifications, counts and the graph.
- **The transcript follows the most private part.** If anything in a conversation is private, the whole transcript is private. It stays private until you explicitly share it again, even after the private item is deleted or shared.
- **People are always shared.** That a person exists, their name and their aliases are visible to both of you. What you know about them is not.
- **Links inherit privacy.** A relationship or a date that came from a private conversation is private as well.
- **Personal views stay personal.** "Last seen", check-in intervals and "overdue" are computed for each of you separately.

## Who can change what

Only the person who recorded an item can delete it or change its visibility. Your partner can see your shared items but can't edit them.

Two safety rules protect shared knowledge:

- A private fact can't replace a shared one. If you learn privately that something your partner recorded is outdated, Claude will ask how to handle it.
- A fact that replaced a shared one can't be made private later.

## How Claude helps

Claude is told to look for sensitive content in every ramble (health, relationship trouble, money, anything said "between us") and to ask you before filing it shared. When only part of a ramble is sensitive, only those items become private and the summary leaves them out.

You can always change your mind: "make the thing about her father private" or "share that dinner with Anna after all".

Privacy is enforced by the server, based on who is signed in. It doesn't depend on Claude getting it right. [Privacy model](../adr/0002-privacy-model.md) has the details.
