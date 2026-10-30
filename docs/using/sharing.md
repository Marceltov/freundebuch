# Sharing files

Your friends post their trips, festivals, new jobs and other big moments on Instagram, LinkedIn and elsewhere; a group chat tells you who has a birthday and who is moving; a letter invites you to a wedding. freundebuch can't read those feeds and chats (see [why](#why-screenshots)), but it can read what you share with it: a **screenshot**, a **photo**, a **PDF**, a **text file** such as a WhatsApp chat export, or a **voice note** (see [below](#voice-notes)).

Sharing needs the instance's Anthropic API key (`FREUNDEBUCH_ANTHROPIC_API_KEY`), the same one the chat uses. Each shared file counts as one chat message against the daily limit.

## What happens to a shared file

1. freundebuch stores it for now (images shrunk to 1080 px wide, PDFs and text as they are), and Claude reads it once: it writes down what the file says, word for word (for a photo, what it shows), suggests what could be filed for whom, and notes who is in it.
2. It waits under **Prüfen** with that suggestion, and you get a push message if you have [notifications](notifications.md) set up. A badge at the top of the app shows how many wait. Nothing is filed on its own.
3. Tap **In Erzählen öffnen**: the chat opens on the file. Claude sees it and its suggestion, asks who is meant and whether something is private, and files a conversation from it with the same tools as when you tell it about a meeting.

**Several files as one.** A chat over three screenshots, or a post and its comments, is one thing. Tick the files under Prüfen and tap **Zusammen prüfen**: the chat opens on all of them in order, Claude reads them together, and filing takes them all. Files you shared in one go (several screenshots at once from the phone) sit together under Prüfen, marked **Zusammen geteilt**, and come ticked when you arrive from the share. A file missing from them, or one that adds context, you share (again) and tick too. **Auswahl verwerfen** throws the ticked files away at once.

**Only the text is kept.** Filing adds the file's transcript to the conversation's transcript, and the file itself is deleted. A file you close with nothing to file, or throw away (**Verwerfen**), is deleted too. So nothing of a shared file outlives its review but the words that were filed, which follow the conversation's privacy like any transcript.

If Claude couldn't read it, the card says why; **Nochmal lesen** tries again.

## Voice notes

A WhatsApp voice note, an iPhone voice memo or any other audio file (Opus/Ogg, M4A, MP3, WAV, WebM, FLAC) is shared like any other file. Claude takes no audio, so freundebuch first has it transcribed by a Whisper server you run yourself ([`FREUNDEBUCH_TRANSCRIBE_URL`](../self-hosting/configuration.md)); the voice note never leaves your servers. Claude then reads the transcript, and it waits under Prüfen like any file, with a player to listen to it again. Once you have gone through it, only the transcript is kept, word for word as Whisper heard it, and the audio is deleted. If it couldn't be transcribed, the card says so and **Nochmal lesen** tries again.

In **Erzählen**, the microphone (in place of the send button while the field is empty) records a message, as on WhatsApp: tap it, speak, tap send. It is transcribed at once and sent as your message; the trash can throws the recording away. The recording itself is never stored, only its words, as the ramble they are.

Without a transcription server, freundebuch takes no audio files and Erzählen shows no microphone.

## From Claude (MCP)

Ask Claude "Was wartet unter Prüfen?": the `inbox` tool hands it the waiting files and their transcripts, and you go through them together. Claude sees which files you shared together and asks which belong to one thing before it files them. When you paste a picture or a PDF into the conversation with Claude, Claude sees it but can't pass it on to freundebuch: it writes out what it shows into the transcript it files. That is all freundebuch would keep of it anyway.

## In the app

In **Erzählen**, the paperclip next to the text field picks files (images, PDFs, text, voice notes) from your phone or computer. What you pick goes along with the chat at once, several files together, so you can tell Claude about them right away. Sharing from the phone (below) is quicker while scrolling.

## Android

1. Open freundebuch in Chrome and add it to the home screen (menu → **Zum Startbildschirm hinzufügen** / **App installieren**).
2. Take a screenshot (or pick a photo, a PDF, a chat export), tap **Teilen**, pick **freundebuch**. freundebuch opens on Prüfen.

If freundebuch asks you to share again right after installing it, do so: the first share can arrive before the app is ready.

## iPhone

iOS doesn't let web apps appear in the share sheet, so a Shortcut does the sending. freundebuch comes with one.

1. In freundebuch on the iPhone, open **Einstellungen → Dateien teilen** and tap **Zugang erzeugen**. Copy the Zugang: the share address and your key in one, shown only once. The key can only hand in files: it can't read anything.
2. Tap **Kurzbefehl laden**, add it in the Kurzbefehle app, and paste the Zugang when it asks.
3. Take a screenshot, or pick several, or a photo, a PDF, a text; tap **Teilen** and scroll to the very bottom: pick **An freundebuch**. freundebuch opens on Prüfen with what you sent ticked.

iPhone photos (HEIC) go as they are. A new Zugang replaces the old one: load the Shortcut again and paste the new one. **Zugang löschen** turns sharing from the Shortcut off.

### Building it yourself

Prefer your own? Make a Shortcut that shows in the share sheet (input: images, PDFs, text, files) and, for each item, does **Inhalte von URL abrufen**: POST to the Adresse zum Teilen, header `Authorization` `Bearer <your key>`, body **Datei** with the item. Add the header `X-Freundebuch-Batch` with one id per run (8–64 letters, digits, `-` or `_`) to have several items shared together. The answer's `url` opens the file under Prüfen.

### Signing a new version (for developers)

The Shortcut is generated from `shortcut/source.ts`. iOS only imports signed Shortcuts, and signing needs a Mac: `npm run shortcut:sign` builds it, signs it into `public/shortcuts/An freundebuch.shortcut` and records the source's hash next to it. A test fails when the source changes without a new signature.

## Why screenshots

- Instagram's API covers only your own business or creator account, and LinkedIn gives no access to other people's activity.
- Tools that log in as you and scrape your feed put your own account at risk of being locked.
- Sites that mirror Instagram see only public accounts.

A screenshot works for every app and every account you can see. Instagram's own share button only passes a link, which freundebuch can't open for a private account.
