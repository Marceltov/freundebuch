"use client";

import { Bell, CalendarPlus, Check, KeyRound, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { CopyField } from "@/components/CopyButton";
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

// Sharing screenshots: how on Android, and the share key the iPhone Shortcut sends (POST/DELETE /api/v1/me/share-key). A new
// key is shown once, right after it was made.
export function ShareSettings({ hasKey, shareUrl }: { hasKey: boolean; shareUrl: string }) {
  const [key, setKey] = useState<string | null>(null);
  const [active, setActive] = useState(hasKey);
  const [failed, setFailed] = useState(false);

  async function create() {
    const res = await fetch("/api/v1/me/share-key", { method: "POST" }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) {
      setKey(((await res.json()) as { key: string }).key);
      setActive(true);
    }
  }
  async function revoke() {
    const res = await fetch("/api/v1/me/share-key", { method: "DELETE" }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) {
      setKey(null);
      setActive(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{copy.shareHint}</p>
      <p>{copy.shareAndroid}</p>
      <p>{copy.shareIphone}</p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        {copy.shareSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <CopyField label={copy.shareUrl} text={shareUrl} />
      {key && (
        <>
          <CopyField label={copy.shareKey} text={key} />
          <p className="text-muted">{copy.shareKeyOnce}</p>
        </>
      )}
      {!key && active && <p className="text-muted">{copy.shareKeyActive}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={create} className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          <KeyRound aria-hidden className="h-4 w-4" />
          {active ? copy.shareKeyReplace : copy.shareKeyNew}
        </button>
        {active && (
          <button type="button" onClick={revoke} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-1.5 font-bold">
            <Trash2 aria-hidden className="h-4 w-4" />
            {copy.shareKeyRevoke}
          </button>
        )}
        {failed && (
          <span role="status" className="text-error">
            {copy.actionFailed}
          </span>
        )}
      </div>
    </div>
  );
}

// The calendar feed (POST/DELETE /api/v1/me/calendar-feed): a secret URL to subscribe to. A new one is shown once, right after
// it was made, with a webcal:// link that opens the phone's calendar app.
export function CalendarSettings({ hasFeed }: { hasFeed: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState(hasFeed);
  const [failed, setFailed] = useState(false);

  async function create() {
    const res = await fetch("/api/v1/me/calendar-feed", { method: "POST" }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) {
      setUrl(((await res.json()) as { url: string }).url);
      setActive(true);
    }
  }
  async function revoke() {
    const res = await fetch("/api/v1/me/calendar-feed", { method: "DELETE" }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) {
      setUrl(null);
      setActive(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{copy.calendarHint}</p>
      {url && (
        <>
          <CopyField label={copy.calendarUrl} text={url} />
          <p className="text-muted">{copy.calendarOnce}</p>
          <a href={url.replace(/^https?:/, "webcal:")} className="inline-block font-bold text-carbon">
            {copy.calendarOpen}
          </a>
        </>
      )}
      {!url && active && <p className="text-muted">{copy.calendarActive}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={create} className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
          <CalendarPlus aria-hidden className="h-4 w-4" />
          {active ? copy.calendarReplace : copy.calendarNew}
        </button>
        {active && (
          <button type="button" onClick={revoke} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-1.5 font-bold">
            <Trash2 aria-hidden className="h-4 w-4" />
            {copy.calendarRevoke}
          </button>
        )}
        {failed && (
          <span role="status" className="text-error">
            {copy.actionFailed}
          </span>
        )}
      </div>
    </div>
  );
}
