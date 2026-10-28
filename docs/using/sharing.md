# Sharing files

Your friends post their trips, festivals, new jobs and other big moments on Instagram, LinkedIn and elsewhere; a group chat tells you who has a birthday and who is moving; a letter invites you to a wedding. freundebuch can't read those feeds and chats (see [why](#why-screenshots)), but it can read what you share with it: a **screenshot**, a **photo**, a **PDF**, or a **text file** such as a WhatsApp chat export. Voice notes come later ([#58](https://github.com/Marceltov/freundebuch/issues/58)).

Sharing needs the instance's Anthropic API key (`FREUNDEBUCH_ANTHROPIC_API_KEY`), the same one the chat uses. Each shared file counts as one chat message against the daily limit.

## What happens to a shared file

1. freundebuch stores it (images shrunk to 1080 px wide, PDFs and text as they are), and Claude reads it once: what it is, what could be filed for whom, and who is in it.
2. It waits under **Prüfen** with that suggestion, and you get a push message if you have [notifications](notifications.md) set up. A badge at the top of the app shows how many wait. Nothing is filed on its own.
3. Tap **In Erzählen öffnen**: the chat opens on the file. Claude sees it and its suggestion, asks who is meant and whether something is private, and files with the same tools as when you tell it about a meeting. The file is then done and leaves Prüfen.

If Claude couldn't read it, the card says why; **Nochmal lesen** tries again. **Verwerfen** throws a file away.

What is filed from a file keeps it: a fact shows it as a small picture, a conversation lists its files. Your partner sees a file only when they can see the fact or the conversation; files waiting for you are yours alone. Deleting what was filed from it deletes the file.

## From Claude (MCP)

Ask Claude "Was wartet unter Prüfen?": the `inbox` tool hands it the waiting files themselves, and you go through them together. When you paste a picture or a PDF into the conversation with Claude, Claude sees it but can't pass it on to freundebuch: it writes out what it shows into what it files (the text word for word in the transcript). If you want the original kept, Claude gives you the link to **Hochladen**, where you drop the files; they then wait under Prüfen, and Claude files with them.

## In the app

In **Erzählen**, the paperclip next to the text field picks files from your phone or computer. One file goes along with the chat at once, so you can tell Claude about it right away; several wait under Prüfen. **Hochladen** (`/hochladen`) takes several files at once. Sharing from the phone (below) is quicker while scrolling.

## Android

1. Open freundebuch in Chrome and add it to the home screen (menu → **Zum Startbildschirm hinzufügen** / **App installieren**).
2. Take a screenshot (or pick a photo, a PDF, a chat export), tap **Teilen**, pick **freundebuch**. freundebuch opens on Prüfen.

If freundebuch asks you to share again right after installing it, do so: the first share can arrive before the app is ready.

## iPhone

iOS doesn't let web apps appear in the share sheet, so a Shortcut does the sending.

1. In freundebuch, open **Einstellungen → Dateien teilen** and tap **Schlüssel erzeugen**. Copy the key; it is shown only once. The key can only hand in files: it can't read anything.
2. In the **Kurzbefehle** app, create a shortcut named "An freundebuch":
    - In its details, turn on **Im Share-Sheet anzeigen** and set the input to **Bilder**, **PDFs**, **Text** and **Dateien**.
    - Add **Inhalte von URL abrufen** with the address shown in the settings (`https://<your instance>/api/share`). Method **POST**, header `Authorization` with the value `Bearer <your key>`, request body **Datei** with **Kurzbefehleingabe**.
    - Add **URL öffnen** with `url` from the result: it takes you straight to the file under Prüfen. (Or **Ergebnis anzeigen** with `message`, to stay where you are.)
3. Take a screenshot (or pick a file), tap **Teilen**, pick **An freundebuch**.

A new key replaces the old one; **Schlüssel löschen** turns sharing from the Shortcut off.

## Why screenshots

- Instagram's API covers only your own business or creator account, and LinkedIn gives no access to other people's activity.
- Tools that log in as you and scrape your feed put your own account at risk of being locked.
- Sites that mirror Instagram see only public accounts.

A screenshot works for every app and every account you can see. Instagram's own share button only passes a link, which freundebuch can't open for a private account.
