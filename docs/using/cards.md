# Own cards

Your card is what you say about yourself: your name, number, email, address, birthday and a note. You give its link to the friends you want to have it. Their freundebuch, or any contacts app, fetches it once a day, so your new number reaches them without anyone typing it in. It's the only thing that ever goes from your book to someone else, and only because you gave the link ([V3](../values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).

## Your card

In **Einstellungen → Deine Karte**, fill in what you want to share and save. **Link erzeugen** makes the link, shown once: copy it and send it to your friends. A new link ends the old one at once, and so does **Link beenden**. Those who subscribed keep the card as they last got it, but get nothing new.

The link serves a standard vCard. Any app that subscribes to a contact by URL can read it, not only freundebuch.

Over MCP: "Put my new number on my card", "Make a link to my card" (`cards`).

## A friend's card

When a friend sends you the link to their card, open their page in freundebuch and paste it under **Ihre Karte → Karte verknüpfen**, or give it to Claude. freundebuch fetches it now and again once a day. Their number, email and address show on their page, and their briefing has them as `card`. The card holds their own words, kept apart from what you told Claude about them, and both of you in the household see it.

freundebuch fetches a card only from an `https` address on the internet, follows no redirects and reads at most 64 KB. It never fetches from your own server or the networks behind it. If the link stops working (your friend ended it), the page says so and keeps the last card.
