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
  persons: { id: string; name: string; created_by: string; created_from: string | null; created_at: number };
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
  facts: Item & { id: string; person_id: string; text: string; category: string; status: ColumnType<"current" | "outdated", "current" | "outdated" | undefined, "current" | "outdated"> };
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
  groups: { id: string; name: string };
  group_members: { group_id: string; person_id: string; visibility: string; recorded_by: string };
  user_settings: { user_id: string; webhook_url: string | null };
  meta: { key: string; value: string };
}
