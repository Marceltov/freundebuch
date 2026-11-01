// Which tables belong to a book and which to the instance. A book table is reached only through the scope (scope.ts); an instance
// table only through instance(). `members` carries a book_id but decides which books a user may open, so it is the instance's.
import type { Schema } from "./schema";

export const INSTANCE_TABLES = ["users", "user_settings", "own_cards", "chat_usage", "meta", "books", "members", "invitations"] as const;
export type InstanceTable = (typeof INSTANCE_TABLES)[number];
export type BookTable = Exclude<keyof Schema, InstanceTable>;
export const isBookTable = (t: string): t is BookTable => !(INSTANCE_TABLES as readonly string[]).includes(t) && !t.startsWith("kysely_");

/** The book tables whose rows have an id of their own: what an id a tool is given can be. */
export const KEYED_TABLES = [
  "rambles",
  "places",
  "series",
  "experiences",
  "conversations",
  "persons",
  "journal_entries",
  "files",
  "facts",
  "promises",
  "dates",
  "exchanges",
  "relationships",
  "groups",
] as const satisfies readonly BookTable[];

/** Every reference from one book table to another (column → table), as the composite keys in the baseline make them. */
export const REFS: Readonly<Record<BookTable, Readonly<Record<string, BookTable>>>> = {
  aliases: { person_id: "persons" },
  card_subscriptions: { person_id: "persons" },
  conversations: { experience_id: "experiences", place_id: "places", ramble_id: "rambles" },
  dates: { ramble_id: "rambles", conversation_id: "conversations", person_id: "persons" },
  exchanges: { ramble_id: "rambles", conversation_id: "conversations", person_id: "persons" },
  experience_people: { person_id: "persons", experience_id: "experiences" },
  experiences: { place_id: "places", series_id: "series", ramble_id: "rambles" },
  facts: { file_id: "files", ramble_id: "rambles", conversation_id: "conversations", superseded_by: "facts", person_id: "persons" },
  files: {},
  group_aliases: { group_id: "groups" },
  group_members: { ramble_id: "rambles", conversation_id: "conversations", person_id: "persons", group_id: "groups" },
  groups: {},
  journal_entries: { ramble_id: "rambles" },
  journal_mentions: { person_id: "persons", entry_id: "journal_entries" },
  participants: { person_id: "persons", conversation_id: "conversations" },
  person_settings: { person_id: "persons" },
  persons: { created_from: "conversations" },
  place_aliases: { place_id: "places" },
  place_owners: { ramble_id: "rambles", person_id: "persons", place_id: "places" },
  places: { parent_id: "places" },
  promises: { ramble_id: "rambles", conversation_id: "conversations", person_id: "persons" },
  rambles: {},
  relationships: { ramble_id: "rambles", conversation_id: "conversations", to_id: "persons", from_id: "persons" },
  series: { place_id: "places" },
  series_skips: { series_id: "series" },
};

/** The name a book's own group starts with. */
export const HOUSEHOLD_GROUP = "Haushalt";

/** The groups every book starts with, and their other names. */
export const SEEDED_GROUPS: readonly { name: string; aliases: string[] }[] = [
  { name: "Freunde", aliases: ["Freundeskreis"] },
  { name: "Familie", aliases: ["Verwandte"] },
  { name: "Arbeit", aliases: ["Kollegen", "Job"] },
];
