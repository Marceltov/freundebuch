// One push message to a user-supplied URL, ntfy-style: the text as the body, Title, Tags and Click as headers. The URL is the
// user's secret (ntfy topics are unguessable names), so neither it nor the reply is ever logged.
import { errorFields, logger } from "../core/log";

const log = logger("notify");

export type WebhookMessage = {
  title: string;
  body: string;
  tags: string[];
  /** Where a tap on the message goes; left out when the instance's address is unknown. */ click?: string;
};

// A header value is Latin-1 only; ntfy reads anything else as RFC 2047 encoded words.
const header = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);

/** True when the receiver answered 2xx. Redirects are not followed: the URL was typed by a user. */
export async function sendWebhook(url: string, msg: WebhookMessage, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const headers: Record<string, string> = { "Content-Type": "text/plain; charset=utf-8", Title: header(msg.title), Tags: msg.tags.join(",") };
  if (msg.click) headers.Click = msg.click;
  try {
    const res = await fetchFn(url, { method: "POST", headers, body: msg.body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (res.status >= 200 && res.status < 300) return true;
    log.warn({ status: res.status }, "webhook answered with an error");
    return false;
  } catch (e) {
    // The message of a network error can name the URL: log only its type.
    log.warn({ err: { type: errorFields(e).type } }, "webhook failed");
    return false;
  }
}
