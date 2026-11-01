# The web app

The web app is in German, or in English for whoever chooses it in **Einstellungen** (Settings), made for a quick look on the phone before you meet someone. It looks like a friendship book: every face is a sticker, every person a page. The bar at the bottom leads to its four places: **Start**, **Verlauf**, **Leute** and **Bald**.

## Start

<div class="fb-shots" markdown>
![The start page in light mode](../assets/orbit.png)
![The start page in dark mode](../assets/orbit-dark.png)
</div>

A greeting tells you how many people would be glad to hear from you, and **Frag mal nach** below the orbit lists the situations nobody has heard about for a while. Below it, you're in the middle ("Du"), and everyone sits on one of three rings with their first name under them: the inner ring for people you saw recently, the outer ring for people you're due to see. People you haven't met yourself yet (someone your partner filed, or someone who was only mentioned) fill the free places on the outer ring with a faded face, so a new member of the household sees its people right away. Small badges show what's waiting:

- 🎂 a birthday coming up,
- 📌 an open promise,
- 🎁 a gift idea.

The group chips above the orbit put a group's members first and fade everyone else. Tap a face to open the person. Until you've filed something yourself, a hint below the orbit says how to start: tell it in **Erzählen**, or connect Claude.

## A friend's page

<div class="fb-shots" markdown>
![Sarah's page](../assets/friend.png)
</div>

From top to bottom:

- who they are to you, right under the name: "Unsere Vermieterin", "Kollegin von dir", "Kollege von Sybille",
- when you last saw them, their birthday with their age today ("12. Juli 1994 · 32 Jahre"), their check-in interval and their groups (**+ Gruppe** adds or removes groups),
- **Gerade los**: what is going on and will end (moving, looking for a car). One nobody has asked about for a while is highlighted: "Frag mal nach – seit 6 Wochen nichts gehört". The **…** of one you filed moves it to **Gut zu wissen** or sets the day to ask (**Nachfragen am …**),
- **Gut zu wissen**: what stays true (works at Hornbach, likes Riesling, a nut allergy), each with an icon for its kind; **Ist gerade los** in its **…** moves it up,
- **Versprochen**, **Ideen für Geschenke** and **Noch offen**: promises, gift ideas and other exchanges, with quick actions,
- **Gespräche**: the conversations, newest first,
- **Gehört zu**: a diagram with you (and your partner, when they are related too) on top, the person in the middle and their own people below, each line saying what it is ("Vermieterin", "Sohn"). Tap a face to open them. **Alle Verbindungen** below it lists each with what they are to this person ("Patentante") and its note; with more people than the diagram fits, the list is shown instead. The … menu changes what they are or deletes it (yours, or your partner's shared ones), and makes your own private or shared. Telling freundebuch the same relationship again (also the other way round) files nothing new.

The round **…** next to the name sets how often you want to see them, their gender ("Unsere" or "Unser"; Claude puts the words themselves in it), how they look (the parts of their avatar: face, skin, hair, glasses, beard; easiest is to describe them to Claude), renames them, adds a nickname, or merges a duplicate into them.

Private items have a lock icon. Only you see them.

## A conversation

The date and place, who was there and who was only mentioned (by name), the summary, and **Daraus gemerkt**: everything filed from it, as sentences. Every name links to the person; **›** opens an item on the person's page. Done and outdated items stay listed, marked as such. The **…** in the header changes the summary or the date, or deletes the conversation.

## Erzählen

When your instance has an Anthropic API key ([configuration](../self-hosting/configuration.md)), a raised **Erzählen** button sits in the middle of the bottom bar. It opens a chat with Claude over whatever page you're on. Tell it what happened (type, dictate, or speak it in with the microphone, [voice notes](sharing.md#voice-notes)) and it files it, just as Claude does over MCP: it asks before filing anything sensitive as shared, asks which Anna you mean, and reads back what it filed with links under its reply. It also takes things that aren't a conversation, like "Malou hat am 7.2.2024 Geburtstag". Ask it about someone ("Was war nochmal mit Marvins Spiegel?") and it looks them up.

Your message moves into the chat as soon as you send it, and a bubble shows while Claude thinks. **Enter** starts a new line; the send button sends (on a computer also Ctrl+Enter or ⌘+Enter). With the phone's keyboard open, the chat shrinks to the space above it.

Opened on someone's page, the chat knows who you probably mean ("Es geht um Marvin"); tap the chip away if not. The conversation stays on your device until you start a new one, kept apart per user, so your partner signing in on the same device doesn't see it; the server keeps only what gets filed. Claude acts as you, so it never sees your partner's private items.

## Verlauf, Leute, Bald

With several books (the household's and one of your own for work, say), every list shows what is in all of them, as one: Start, Verlauf, Leute, Bald and the Tagebuch. Each entry then carries a small mark with its book's name, and so does a friend's page. Someone who is in two of your books, like your partner, shows once. The group chips merge groups of the same name: **Freunde** shows the Freunde of every book.

- **Verlauf**: every ramble, newest first, by week and month, with the conversations and your journal entries filed from it. The search field finds what was told by a word you remember ("Spiegel"): every hit with its day, who it was about and the matching words marked; only what you may see, never the other's private items. The **Tagebuch** button opens your [journal](journal.md); a ramble opens on its own page (**Erzählung**) with its transcript. **Weitererzählen** there opens Erzählen on it: add what you forgot ("Anna war auch da") or correct what was filed, and Claude fixes the conversations and items filed from it.
- **Leute**: everyone, A to Z, with a search over names and nicknames and the group chips; **Ohne Gruppe** narrows to those in no group yet.
- **Bald**: the next two weeks: birthdays and other dates, your promises with a due day (tick them off right there), who would be glad to hear from you, and what to ask about.

## Sharing a link

The share button next to a person's, conversation's or group's name sends its link: on a phone through the share sheet (Signal, WhatsApp, Messages), elsewhere by copying it. **Link teilen** in an entry's … menu does the same for that one entry, which opens highlighted. Whoever opens the link signs in and sees what is shared with them, so your partner sees the page without your private entries; a private entry's link shows them nothing.

## Settings

The gear icon opens **Einstellungen**: your language (**Sprache**: Deutsch or English, for the app and your notifications; each of you chooses their own, and what is filed keeps the words it was filed in), your webhook for [notifications](notifications.md), your [calendar feed](calendar.md), your **Bücher** (below), your groups and their other names, book by book, and signing out. **Haushalt** is the group of everyone who signs in: rename it (Herziis, say), but it can't be deleted or merged away.

### Bücher

**Bücher** in Einstellungen lists your books, your role in each and who else is in it. What you can do there follows your role:

- Everyone can **leave** a book, except their only one. The owner hands it over first.
- The owner and the admins **rename** the book, **invite** members, see the open invitations and revoke them, and **remove** members. An invitation is a link that works once, for 7 days: pass it on however you like.
- Only the owner invites admins, makes someone an admin or a member again, **hands the book over** (and stays an admin), and **deletes** it.
- Leaving, or being removed, deletes what that person marked private in the book. What they shared stays.
- **Neues Buch** makes a book of your own.

To move someone into another of your books, open the **…** on their page and choose **In ein anderes Buch**. They go with what is filed about them, under a new address; if someone else's private entry in the old book still points at them, an entry for them stays there too, and the page says so.
