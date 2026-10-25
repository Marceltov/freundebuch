# Sharing screenshots

Your friends post their trips, festivals, new jobs and other big moments on Instagram, LinkedIn and elsewhere. freundebuch can't read those feeds (see [why](#why-screenshots)), but it can read a screenshot. Take one while scrolling, share it with freundebuch, and it lands on the person's page. The next time you ask about them, or get a briefing, it's there: "Urlaub in Lissabon · Instagram, 12. Oktober".

Sharing needs the instance's Anthropic API key (`FREUNDEBUCH_ANTHROPIC_API_KEY`), the same one the chat uses. Each screenshot counts as one chat message against the daily limit.

## What happens to a screenshot

1. freundebuch stores it, shrunk to 1080 px wide, and Claude reads it: whose post it is, what happened, where it was posted and when.
2. **Sure** about the person, and nothing sensitive in it: it is filed as a fact on that person, shared with your household like anything else you file. You get no message.
3. **Not sure** (two people could be meant, or the person isn't in freundebuch yet), or it looks **sensitive** (health, a breakup, money): it waits under **Zu prüfen**, and you get a push message if you have [notifications](notifications.md) set up. A badge at the top of the app shows how many wait.
4. **Nothing personal** in it (an ad, a meme): it is thrown away, with a short push.

On **Zu prüfen** you pick the person, or create a new one, correct the text if needed, and choose **Nur für mich** to file it privately. The account name Claude read (`@anna.reist`) becomes one of the person's other names, so their next post is filed without asking.

The screenshot is kept and shown as a small picture next to the fact. Your partner sees it only when they can see the fact; screenshots waiting for you are yours alone. Deleting the fact deletes the screenshot.

## Android

1. Open freundebuch in Chrome and add it to the home screen (menu → **Zum Startbildschirm hinzufügen** / **App installieren**).
2. Take a screenshot, tap **Teilen**, pick **freundebuch**.

If freundebuch asks you to share again right after installing it, do so: the first share can arrive before the app is ready.

## iPhone

iOS doesn't let web apps appear in the share sheet, so a Shortcut does the sending.

1. In freundebuch, open **Einstellungen → Screenshots teilen** and tap **Schlüssel erzeugen**. Copy the key; it is shown only once. The key can only hand in screenshots: it can't read anything.
2. In the **Kurzbefehle** app, create a shortcut named "An freundebuch":
    - In its details, turn on **Im Share-Sheet anzeigen** and set the input to **Bilder**.
    - Add **Inhalte von URL abrufen** with the address shown in the settings (`https://<your instance>/api/share`). Method **POST**, header `Authorization` with the value `Bearer <your key>`, request body **Datei** with **Kurzbefehleingabe**.
    - Optionally add **Ergebnis anzeigen** with `message` from the result ("Danke! freundebuch liest den Screenshot.").
3. Take a screenshot, tap **Teilen**, pick **An freundebuch**.

A new key replaces the old one; **Schlüssel löschen** turns sharing from the Shortcut off.

## Why screenshots

- Instagram's API covers only your own business or creator account, and LinkedIn gives no access to other people's activity.
- Tools that log in as you and scrape your feed put your own account at risk of being locked.
- Sites that mirror Instagram see only public accounts.

A screenshot works for every app and every account you can see. Instagram's own share button only passes a link, which freundebuch can't open for a private account.
