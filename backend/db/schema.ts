// The tables, as Kysely sees them. Times are milliseconds since the epoch; booleans are 0/1 integers. An item's `conversation_id`
// is null when no conversation recorded it.
import type { ColumnType } from "kysely";

type Flag = ColumnType<number, number | undefined, number>;

interface Item {
  visibility: string;
  recorded_by: string;
  conversation_id: string | null;
  created_at: number;
}

export interface Schema {
  users: { id: string; oidc_sub: string; name: string; email: string | null; person_id: string | null; created_at: number };
  persons: {
    id: string;
    name: string;
    created_by: string;
    created_from: string | null;
    created_at: number;
    gender: ColumnType<"female" | "male" | "nonbinary" | null, "female" | "male" | "nonbinary" | null | undefined, "female" | "male" | "nonbinary" | null>;
  };
  aliases: { person_id: string; alias: string; norm: string };
  person_settings: { user_id: string; person_id: string; interval_days: number | null; interval_confirmed: Flag };
  conversations: {
    id: string;
    date: string;
    kind: string;
    place: string | null;
    summary: string;
    transcript: string;
    transcript_private: Flag;
    visibility: string;
    recorded_by: string;
    created_at: number;
  };
  participants: { conversation_id: string; person_id: string };
  facts: Item & {
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
    screenshot_id: ColumnType<string | null, string | null | undefined, string | null>;
    kind: ColumnType<"lasting" | "situation", "lasting" | "situation" | undefined, "lasting" | "situation">;
    /** On a situation: the day (YYYY-MM-DD) after which to ask how it went; null on a lasting fact. */
    check_after: ColumnType<string | null, string | null | undefined, string | null>;
  };
  promises: Item & { id: string; person_id: string; text: string; by_me: number; due: string | null; done: Flag };
  dates: Item & { id: string; person_id: string; kind: "birthday" | "anniversary" | "custom"; date: string; label: string | null; yearly: Flag };
  exchanges: Item & {
    id: string;
    person_id: string;
    kind: string;
    direction: "to_them" | "from_them";
    text: string;
    amount: number | null;
    currency: string | null;
    settled: Flag;
  };
  relationships: Item & { id: string; from_id: string; to_id: string; type: string; note: string | null };
  groups: { id: string; name: string; created_by: string | null; created_at: number; seeded: Flag };
  group_aliases: { group_id: string; alias: string; norm: string };
  group_members: { group_id: string; person_id: string; visibility: string; recorded_by: string; conversation_id: string | null };
  chat_usage: { user_id: string; day: string; count: number };
  user_settings: {
    user_id: string;
    webhook_url: string | null;
    share_key_hash: ColumnType<string | null, string | null | undefined, string | null>;
    calendar_key_hash: ColumnType<string | null, string | null | undefined, string | null>;
  };
  screenshots: {
    id: string;
    user_id: string;
    sha256: string;
    status: "reading" | "pending" | "filed" | "nothing" | "failed";
    /** JSON of a `Reading` (screenshots.ts), once Claude has read the image. */
    reading: string | null;
    created_at: number;
  };
  meta: { key: string; value: string };
}
