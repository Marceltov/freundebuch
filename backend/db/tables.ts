// Which tables belong to a book and which to the instance. A book table is reached only through the scope (scope.ts); an instance
// table only through instance(). `members` carries a book_id but decides which books a user may open, so it is the instance's.
import type { Schema } from "./schema";

export const INSTANCE_TABLES = ["users", "user_settings", "own_cards", "chat_usage", "meta", "books", "members"] as const;
export type InstanceTable = (typeof INSTANCE_TABLES)[number];
export type BookTable = Exclude<keyof Schema, InstanceTable>;
export const isBookTable = (t: string): t is BookTable => !(INSTANCE_TABLES as readonly string[]).includes(t) && !t.startsWith("kysely_");

/** The name a book's own group starts with. */
export const HOUSEHOLD_GROUP = "Haushalt";

/** The groups every book starts with, and their other names. */
export const SEEDED_GROUPS: readonly { name: string; aliases: string[] }[] = [
  { name: "Freunde", aliases: ["Freundeskreis"] },
  { name: "Familie", aliases: ["Verwandte"] },
  { name: "Arbeit", aliases: ["Kollegen", "Job"] },
];
