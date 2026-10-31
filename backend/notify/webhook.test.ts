import { describe, expect, test } from "vitest";
import { logsOf } from "../core/log";
import { sendWebhook } from "./webhook";

type Call = { url: string; init: RequestInit };
const fake = (status = 200) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("secret reply", { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
};

describe("sendWebhook", () => {
  test("POSTs the body as text/plain with Title, Tags and Click", async () => {
    const { calls, fetchFn } = fake();
    const ok = await sendWebhook(
      "https://ntfy.example/topic",
      { title: "Hallo", body: "Zuletzt am 2026-01-01", tags: ["a", "b"], click: "https://f.example/p/1" },
      fetchFn,
    );
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ntfy.example/topic");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe("Zuletzt am 2026-01-01");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "text/plain; charset=utf-8", Title: "Hallo", Tags: "a,b", Click: "https://f.example/p/1" });
  });

  test("a Title with emoji or umlauts is sent RFC 2047 encoded, which a header value can carry", async () => {
    const { calls, fetchFn } = fake();
    await sendWebhook("https://ntfy.example/t", { title: "🎂 Jörg hat heute Geburtstag", body: "", tags: [] }, fetchFn);
    const title = (calls[0].init.headers as Record<string, string>).Title;
    expect(title).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(Buffer.from(title.slice(10, -2), "base64").toString("utf8")).toBe("🎂 Jörg hat heute Geburtstag");
    expect((calls[0].init.headers as Record<string, string>).Click).toBeUndefined();
  });

  test("a non-2xx answer is false, and neither the URL nor the reply is logged", async () => {
    const { fetchFn } = fake(500);
    let ok: boolean | undefined;
    const lines = await logsOf(async () => (ok = await sendWebhook("https://ntfy.example/very-secret-topic", { title: "t", body: "b", tags: [] }, fetchFn)));
    expect(ok).toBe(false);
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toMatch(/very-secret-topic|secret reply/);
  });

  test("a redirect is not followed and counts as failure", async () => {
    const { fetchFn } = fake(302);
    expect(await sendWebhook("https://ntfy.example/t", { title: "t", body: "b", tags: [] }, fetchFn)).toBe(false);
  });

  test("a network error is false and the URL stays out of the log", async () => {
    const fetchFn = (async () => {
      throw new Error("connect ECONNREFUSED https://ntfy.example/very-secret-topic");
    }) as unknown as typeof fetch;
    let ok: boolean | undefined;
    const lines = await logsOf(async () => (ok = await sendWebhook("https://ntfy.example/very-secret-topic", { title: "t", body: "b", tags: [] }, fetchFn)));
    expect(ok).toBe(false);
    expect(JSON.stringify(lines)).not.toContain("very-secret-topic");
  });
});
