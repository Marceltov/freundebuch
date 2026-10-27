# The web app

The web app is in German, made for a quick look on the phone before you meet someone. It looks like a friendship book: every face is a sticker, every person a page. The bar at the bottom leads to its four places: **Start**, **Verlauf**, **Leute** and **Bald**.

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

The round **…** next to the name sets how often you want to see them, their gender ("Unsere" or "Unser"; Claude puts the words themselves in it), renames them, adds a nickname, or merges a duplicate into them.

Private items have a lock icon. Only you see them.

## A conversation

The date and place, who was there and who was only mentioned (by name), the summary, and **Daraus gemerkt**: everything filed from it, as sentences. Every name links to the person; **›** opens an item on the person's page. Done and outdated items stay listed, marked as such. The **…** in the header changes the summary or the date, or deletes the conversation.

## Erzählen

When your instance has an Anthropic API key ([configuration](../self-hosting/configuration.md)), a raised **Erzählen** button sits in the middle of the bottom bar. It opens a chat with Claude over whatever page you're on. Tell it what happened (type or dictate) and it files it, just as Claude does over MCP: it asks before filing anything sensitive as shared, asks which Anna you mean, and reads back what it filed with links under its reply. It also takes things that aren't a conversation, like "Malou hat am 7.2.2024 Geburtstag". Ask it about someone ("Was war nochmal mit Marvins Spiegel?") and it looks them up.

Your message moves into the chat as soon as you send it, and a bubble shows while Claude thinks. **Enter** starts a new line; the send button sends (on a computer also Ctrl+Enter or ⌘+Enter). With the phone's keyboard open, the chat shrinks to the space above it.

Opened on someone's page, the chat knows who you probably mean ("Es geht um Marvin"); tap the chip away if not. The conversation stays on your device until you start a new one, kept apart per user, so your partner signing in on the same device doesn't see it; the server keeps only what gets filed. Claude acts as you, so it never sees your partner's private items.

## Verlauf, Leute, Bald

- **Verlauf**: every conversation, newest first, by week and month.
- **Leute**: everyone, A to Z, with a search over names and nicknames and the group chips.
- **Bald**: the next two weeks: birthdays and other dates, your promises with a due day (tick them off right there), who would be glad to hear from you, and what to ask about.

## Settings

The gear icon opens **Einstellungen**: your webhook for [notifications](notifications.md), your [calendar feed](calendar.md), your groups and their other names, and signing out.
