# Where freundebuch is going

freundebuch started as a personal CRM: you tell Claude about a meeting, and before the next one Claude tells you what is going on in that person's life. It is growing into the hub of your life: what you experience, who you meet where, and what you think, all by talking, never by filling in forms. People stay at its centre, because they are what you ask about before a meeting.

This page says what is planned and why, inside what freundebuch [stands for](values.md). Each item links its issue and the value it serves. There are no dates: an item leaves this page when it ships (the [release notes](https://github.com/Marceltov/freundebuch/releases) have it) or when it is dropped, with the reason in its issue.

## The idea behind all of it

You only talk; Claude sorts, links and keeps it up. A personal CRM fails when it needs fields filled in and links maintained by hand. Here a ramble is stored once, word for word, and Claude splits it into what it holds (a meeting, a thought about yourself, news about someone, a place) and links the parts, asking only when something is unclear. Claude is the interface: everything works over MCP first ([V7](values.md#v7-ai-native-claude-first)).

## Now

- **Places that nest and homes** ([#78](https://github.com/Marceltov/freundebuch/issues/78)): the Olympiahalle in München, Anna's flat with its address, filled in from what you tell; "where were we with Anna?" over Claude.

## Next

- **Voice notes** ([#58](https://github.com/Marceltov/freundebuch/issues/58)): transcribed on your own server, so a WhatsApp voice note can be worked through like any shared file ([V4](values.md#v4-only-words-are-kept)).
- **Avatars** ([#49](https://github.com/Marceltov/freundebuch/issues/49)): a stylized avatar per person, put together from a description.

## Later

- **Several households per instance, and a hosted freundebuch** ([#69](https://github.com/Marceltov/freundebuch/issues/69)): each account a person, a household the people who share a book; the same on a hosted instance as on your own ([V1](values.md#v1-a-book-for-each-household), [V6](values.md#v6-self-hosting-has-everything)).
- **Own cards** ([#70](https://github.com/Marceltov/freundebuch/issues/70)): what a person says about themselves (number, address, birthday), shared by a link they can revoke. The only thing that crosses between people ([V3](values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).
- **Birthday messages you send** ([#71](https://github.com/Marceltov/freundebuch/issues/71)): drafted by freundebuch, seen and sent by you through an integration, never on its own ([V3](values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).
- **Internationalization** ([#72](https://github.com/Marceltov/freundebuch/issues/72)): the app in more languages than German.
- **A map of where things happened**: places kept in words today could be put on a map later. Not now: the web UI stays small, it would need map tiles and a geocoder without calling out ([V6](values.md#v6-self-hosting-has-everything)), and tools that track where you have been exist already.

## Parked

- **A contact book with CardDAV** ([#73](https://github.com/Marceltov/freundebuch/issues/73)): your phone's address book synced with freundebuch, people private or shared by whose book they are in. Not needed yet.

## Decided against

- **Federation between instances.** A protocol that can never be dropped, trust between servers, deletion across servers you don't control: too much risk to [V2](values.md#v2-private-stays-private-through-every-door) for what is needed. Own cards by link cover it.
- **Sharing notes about people beyond the household.** What you think about someone is your perception; it is worthless to someone who doesn't know them and harmful to someone who does. Only a person's own card crosses ([V3](values.md#v3-nothing-reaches-the-people-in-the-book-unless-you-send-it)).
- **Fields and forms to maintain by hand,** as Monica has. Whatever freundebuch knows comes from what you tell it.
