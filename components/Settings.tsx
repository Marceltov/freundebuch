"use client";

import { Bell, Check, Send } from "lucide-react";
import { useState } from "react";
import { copy } from "@/components/copy";

// The viewer's webhook for the daily reminders: saved with PUT /api/v1/me/settings, tried with POST /api/v1/me/settings/test.
export function WebhookSettings({ webhookUrl }: { webhookUrl: string | null }) {
  const [url, setUrl] = useState(webhookUrl ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<boolean> {
    const res = await fetch("/api/v1/me/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: url.trim() || null }),
    }).catch(() => null);
    setStatus(res?.ok ? { ok: true, text: copy.saved } : { ok: false, text: res?.status === 400 ? copy.webhookInvalid : copy.actionFailed });
    return !!res?.ok;
  }

  async function test() {
    if (!(await save())) return;
    const res = await fetch("/api/v1/me/settings/test", { method: "POST" }).catch(() => null);
    const sent = res?.ok && ((await res.json()) as { sent: boolean }).sent;
    setStatus(sent ? { ok: true, text: copy.testSent } : { ok: false, text: copy.testNotSent });
  }

  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    await f();
    setBusy(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(save)();
      }}
    >
      <label htmlFor="webhook" className="flex items-center gap-2 font-bold">
        <Bell aria-hidden className="h-4 w-4" />
        {copy.webhook}
      </label>
      <p id="webhook-hint" className="mt-1 mb-2 text-sm text-muted">
        {copy.webhookHint}
      </p>
      <input
        id="webhook"
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://ntfy.sh/…"
        aria-describedby="webhook-hint webhook-status"
        className="w-full rounded-xl border border-rule bg-surface-2 px-3 py-2 text-sm focus:border-carbon focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 text-sm font-bold text-on-carbon disabled:opacity-50">
          <Check aria-hidden className="h-4 w-4" />
          {copy.save}
        </button>
        <button type="button" disabled={busy || !url.trim()} onClick={run(test)} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-1.5 text-sm font-bold disabled:opacity-50">
          <Send aria-hidden className="h-4 w-4" />
          {copy.testWebhook}
        </button>
        <span id="webhook-status" role="status" className={`text-sm ${status?.ok === false ? "text-error" : "text-muted"}`}>
          {status?.text}
        </span>
      </div>
    </form>
  );
}
