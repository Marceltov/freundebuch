// What a user sets for themselves: for now the webhook the daily reminders go to.
import { db } from "./db";
import { InvalidInputError } from "./errors";
import { sendWebhook } from "./notify/webhook";
import { copy } from "./notify/copy";
import type { Viewer } from "./types";

export type Settings = { webhookUrl: string | null };

export async function getSettings(v: Viewer): Promise<Settings> {
  const row = await (await db()).selectFrom("user_settings").select("webhook_url").where("user_id", "=", v.userId).executeTakeFirst();
  return { webhookUrl: row?.webhook_url ?? null };
}

export async function putSettings(v: Viewer, s: Settings): Promise<void> {
  let url = s.webhookUrl?.trim() || null;
  if (url !== null) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InvalidInputError("webhookUrl must be an http or https URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new InvalidInputError("webhookUrl must be an http or https URL");
    url = parsed.href;
  }
  await (await db())
    .insertInto("user_settings")
    .values({ user_id: v.userId, webhook_url: url })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ webhook_url: url }))
    .execute();
}

/** Sends the viewer's webhook one sample message; false when there is none or it didn't take it. */
export async function testWebhook(v: Viewer, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const { webhookUrl } = await getSettings(v);
  if (!webhookUrl) return false;
  return sendWebhook(webhookUrl, { title: copy.testTitle, body: copy.testBody, tags: ["bell"] }, fetchFn);
}
