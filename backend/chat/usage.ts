// The per-user daily limit on calls to Claude: chat messages (chat.ts) and shared files (files.ts) count together.
import { scope } from "../db/scope";
import { config } from "../core/config";
import type { Viewer } from "../core/types";

/** Counts this message (or a shared file, files.ts) against the user's daily limit; false when it is used up. One conditional UPDATE, so messages sent at
 * the same moment can't both slip past the last free one. */
export async function spend(v: Viewer, day: string): Promise<boolean> {
  const d = await scope(v);
  await d.instance
    .insert("chat_usage", { user_id: v.userId, day, count: 0 })
    .onConflict((oc) => oc.doNothing())
    .execute();
  const r = await d.instance
    .update("chat_usage")
    .set((eb) => ({ count: eb("count", "+", 1) }))
    .where("user_id", "=", v.userId)
    .where("day", "=", day)
    .where("count", "<", config.chatDailyLimit())
    .executeTakeFirst();
  return Number(r.numUpdatedRows) === 1;
}
