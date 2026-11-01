// The tables, as Kysely sees them. Times are milliseconds since the epoch; booleans are 0/1 integers. An item's `conversation_id`
// is null when no conversation recorded it.
import type { ColumnType } from "kysely";
import type { FactKind, Role } from "../core/types";

type Flag = ColumnType<number, number | undefined, number>;

interface Item {
  visibility: string;
  recorded_by: string;
  conversation_id: string | null;
  /** The ramble it was told in; null when filed outside one (remember, relate). */
  ramble_id: ColumnType<string | null, string | null | undefined, string | null>;
  created_at: number;
}

export interface Schema {
  /** A book: the people, conversations and items its members keep together; nothing in it points into another book. */
  books: { id: string; name: string; created_by: string; created_at: number };
  /** Who may open a book, the person who is them in it ("me"), their role, and their calendar key for it. */
  members: {
    book_id: string;
    user_id: string;
    person_id: string;
    created_at: number;
    role: ColumnType<Role, Role | undefined, Role>;
    calendar_key_hash: ColumnType<string | null, string | null | undefined, string | null>;
  };
  users: {
    id: string;
    oidc_sub: string;
    name: string;
    email: string | null;
    created_at: number;
    language: ColumnType<"de" | "en", "de" | "en" | undefined, "de" | "en">;
  };
  persons: {
    book_id: string;
    id: string;
    name: string;
    created_by: string;
    created_from: string | null;
    created_at: number;
    gender: ColumnType<"female" | "male" | "nonbinary" | null, "female" | "male" | "nonbinary" | null | undefined, "female" | "male" | "nonbinary" | null>;

    /** JSON of a Look (backend/people/looks.ts), or null. */
    look: ColumnType<string | null, string | null | undefined, string | null>;
  };
  aliases: { book_id: string; person_id: string; alias: string; norm: string };
  person_settings: { book_id: string; user_id: string; person_id: string; interval_days: number | null; interval_confirmed: Flag };
  conversations: {
    book_id: string;
    id: string;
    date: string;
    kind: string;
    place_id: string | null;
    /** The experience it happened at, if any. */
    experience_id: ColumnType<string | null, string | null | undefined, string | null>;
    summary: string;
    /** The ramble it was told in, which holds the transcript. */
    ramble_id: string;
    visibility: string;
    recorded_by: string;
    created_at: number;
  };
  /** What the user told, word for word: one ramble, split into conversations, journal entries and items that point to it. The
   * transcript is the recorder's whenever anything filed from it is private (`transcript_private`). */
  rambles: {
    book_id: string;
    id: string;
    date: string;
    transcript: string;
    transcript_private: Flag;
    visibility: string;
    recorded_by: string;
    created_at: number;
  };
  participants: { book_id: string; conversation_id: string; person_id: string };
  places: {
    book_id: string;
    id: string;
    name: string;
    created_by: string;
    created_at: number;
    /** The place it sits inside, if the user said so. */
    parent_id: ColumnType<string | null, string | null | undefined, string | null>;
    /** Its address in words, as told. */
    address: ColumnType<string | null, string | null | undefined, string | null>;
  };
  /** Whose home a place is, as each user filed it. */
  place_owners: {
    book_id: string;
    place_id: string;
    person_id: string;
    visibility: string;
    recorded_by: string;
    /** The ramble it was told in, if any: it goes when the ramble is deleted. */
    ramble_id: ColumnType<string | null, string | null | undefined, string | null>;
    created_at: number;
  };
  place_aliases: { book_id: string; place_id: string; alias: string; norm: string };
  series: {
    book_id: string;
    id: string;
    name: string;
    kind: string;
    rhythm_days: number | null;
    starts_on: string | null;
    ends_on: string | null;
    place_id: string | null;
    visibility: string;
    recorded_by: string;
    created_at: number;
  };
  series_skips: { book_id: string; series_id: string; date: string };
  experiences: {
    book_id: string;
    id: string;
    ramble_id: string;
    series_id: string | null;
    place_id: string | null;
    date: string;
    kind: string;
    title: string;
    summary: string | null;
    visibility: string;
    recorded_by: string;
    created_at: number;
  };
  experience_people: { book_id: string; experience_id: string; person_id: string };
  /** What the user thinks and feels about their own life, cut from a ramble; private unless they share it. */
  journal_entries: { book_id: string; id: string; ramble_id: string; date: string; text: string; visibility: string; recorded_by: string; created_at: number };
  /** The people a journal entry names. */
  journal_mentions: { book_id: string; entry_id: string; person_id: string };
  facts: Item & {
    book_id: string;
    id: string;
    person_id: string;
    text: string;
    category: string;
    status: ColumnType<"current" | "outdated", "current" | "outdated" | undefined, "current" | "outdated">;
    /** The fact that replaced this one, when one did. */
    superseded_by: ColumnType<string | null, string | null | undefined, string | null>;
    /** Where the fact was read from (a platform such as "Instagram"), when it came from a shared screenshot. */
    source: ColumnType<string | null, string | null | undefined, string | null>;
    /** The day it happened (YYYY-MM-DD), when that is known. */
    happened_on: ColumnType<string | null, string | null | undefined, string | null>;
    file_id: ColumnType<string | null, string | null | undefined, string | null>;
    kind: ColumnType<FactKind, FactKind | undefined, FactKind>;
    /** On a situation: the day (YYYY-MM-DD) after which to ask how it went; null on any other kind. */
    check_after: ColumnType<string | null, string | null | undefined, string | null>;
  };
  promises: Item & { book_id: string; id: string; person_id: string; text: string; by_me: number; due: string | null; done: Flag };
  dates: Item & {
    book_id: string;
    id: string;
    person_id: string;
    kind: "birthday" | "anniversary" | "custom";
    date: string;
    label: string | null;
    yearly: Flag;
  };
  exchanges: Item & {
    book_id: string;
    id: string;
    person_id: string;
    kind: string;
    direction: "to_them" | "from_them";
    text: string;
    amount: number | null;
    currency: string | null;
    settled: Flag;
  };
  relationships: Item & { book_id: string; id: string; from_id: string; to_id: string; label: string; inverse: string; note: string | null };
  /** `household`: the book's own group of its members (Haushalt), which can't be deleted. */
  groups: { book_id: string; id: string; name: string; created_by: string | null; created_at: number; seeded: Flag; household: Flag };
  group_aliases: { book_id: string; group_id: string; alias: string; norm: string };
  group_members: {
    book_id: string;
    group_id: string;
    person_id: string;
    visibility: string;
    recorded_by: string;
    conversation_id: string | null;
    ramble_id: ColumnType<string | null, string | null | undefined, string | null>;
  };
  chat_usage: { user_id: string; day: string; count: number };
  user_settings: {
    user_id: string;
    webhook_url: string | null;
    share_key_hash: ColumnType<string | null, string | null | undefined, string | null>;
    /** The weekly reflection: weekday (0 Sunday … 6 Saturday) and hour, local time; null is off. */
    reflection_day: ColumnType<number | null, number | null | undefined, number | null>;
    reflection_hour: ColumnType<number | null, number | null | undefined, number | null>;
  };
  /** One of a user's own cards, named by `label` ("Privat", "Arbeit"): `card` is the JSON of a Card (cards.ts); `key_hash` its published link's, null while unpublished. */
  own_cards: { id: string; user_id: string; label: string; card: string; key_hash: string | null; created_at: number; updated_at: number };
  /** The card subscribed to for a person: the last one fetched (JSON) and when, when it was last tried, and why that failed (a code), if it did. */
  card_subscriptions: {
    book_id: string;
    person_id: string;
    url: string;
    card: string | null;
    fetched_at: number | null;
    tried_at: number | null;
    failed: string | null;
    added_by: string;
    created_at: number;
  };
  files: {
    book_id: string;
    id: string;
    user_id: string;
    sha256: string;
    /** `nothing`: only on rows from before files, when a pre-read found nothing and the blob went. */
    status: "reading" | "pending" | "filed" | "nothing" | "failed";
    /** JSON of what Claude read (files.ts), once it has. */
    reading: string | null;
    created_at: number;
    /** What was shared: image/webp (images are stored as WebP), application/pdf or text/plain. */
    media_type: ColumnType<string, string | undefined, string>;
    /** Where its bytes are in the blob store (storage.ts). */
    blob_key: string;
    /** The batch id the client sent with it (files shared in one go), or null. */
    batch_id: ColumnType<string | null, string | null | undefined, string | null>;
  };
  meta: { key: string; value: string };
}
