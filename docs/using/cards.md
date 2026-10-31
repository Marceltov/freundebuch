# Own cards

A card is what you say about yourself: your name, number, email, address, birthday and a note. You can keep several, say one for friends and one for work, and give each one's link to the people you want to have it. Their freundebuch, or any contacts app, fetches it once a day, so your new number reaches them without anyone typing it in. It's the only thing that ever goes from your book to someone else, and only because you gave the link ([V3](../values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).

## Your cards

In **Einstellungen → Deine Karten**, name a card (the first is called Privat) and **Karte anlegen**. Fill in what you want to share on it and save. **Link erzeugen** makes its link, shown once: copy it and send it to the people it's for. Every card has its own link. A new link ends that card's old one at once, and so do **Link beenden** and **Karte löschen**. Those who subscribed keep the card as they last got it, but get nothing new. To stop one person from getting a card, make a new link and send it to the others.

The link serves a standard vCard. Any app that subscribes to a contact by URL can read it, not only freundebuch.

Over MCP: "Put my new number on my private card", "Make a work card with my office number", "Make a link to my work card" (`cards`).

## A friend's card

When a friend sends you the link to their card, open their page in freundebuch and paste it under **… → Karte verknüpfen**, or give it to Claude. freundebuch fetches it now and again once a day. Their number, email and address show on their page under **Ihre Karte**, and their briefing has them as `card`. The card holds their own words, kept apart from what you told Claude about them, and both of you in the household see it.

freundebuch fetches a card only from an `https` address on the internet, follows no redirects and reads at most 64 KB. It never fetches from your own server or the networks behind it, also not when the address behind a name changes between the check and the fetch. If the link stops working (your friend ended it), the page says so and keeps the last card.
