// What a user sets for themselves: the webhook the daily reminders go to, and the language they see the app in.
import { scope } from "../db/scope";
import { InvalidInputError } from "./errors";
import { sendWebhook } from "../notify/webhook";
import { notifyCopy } from "../notify/copy";
import { LANGUAGES, type Language, type Viewer } from "./types";

/** `language`: what the app and the notifications speak to this user. */
export type Settings = { webhookUrl: string | null; language: Language };

export async function getSettings(v: Viewer): Promise<Settings> {
  const row = await (await scope(v)).instance.from("user_settings").select("webhook_url").where("user_id", "=", v.userId).executeTakeFirst();
  return { webhookUrl: row?.webhook_url ?? null, language: await userLanguage(v) };
}

/** The language the viewer sees the app in; German when they never chose. */
export async function userLanguage(v: Viewer): Promise<Language> {
  const row = await (await scope(v)).instance.from("users").select("language").where("id", "=", v.userId).executeTakeFirst();
  return row?.language ?? "de";
}

export async function setLanguage(v: Viewer, language: string): Promise<void> {
  if (!LANGUAGES.includes(language as Language)) throw new InvalidInputError(`language must be one of ${LANGUAGES.join(", ")}`);
  await (
    await scope(v)
  ).instance
    .update("users")
    .set({ language: language as Language })
    .where("id", "=", v.userId)
    .execute();
}

export async function putSettings(v: Viewer, s: { webhookUrl: string | null }): Promise<void> {
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
  await (
    await scope(v)
  ).instance
    .insert("user_settings", { user_id: v.userId, webhook_url: url })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ webhook_url: url }))
    .execute();
}

/** Sends the viewer's webhook one sample message; false when there is none or it didn't take it. */
export async function testWebhook(v: Viewer, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const { webhookUrl } = await getSettings(v);
  if (!webhookUrl) return false;
  const copy = notifyCopy(await userLanguage(v));
  return sendWebhook(webhookUrl, { title: copy.testTitle, body: copy.testBody, tags: ["bell"] }, fetchFn);
}
