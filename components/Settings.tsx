"use client";

import { Bell, CalendarPlus, Check, Download, KeyRound, Languages, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Language } from "@/backend";
import { CopyField } from "@/components/CopyButton";
import { useCopy, useLanguage } from "@/components/i18n";

// The viewer's language: saved with PUT /api/v1/me/language, the page then reloads in it.
export function LanguageSettings() {
  const copy = useCopy();
  const language = useLanguage();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  async function choose(next: Language) {
    const res = await fetch("/api/v1/me/language", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: next }),
    }).catch(() => null);
    setFailed(!res?.ok);
    if (res?.ok) router.refresh();
  }
  return (
    <div>
      <h2 className="flex items-center gap-2 font-bold">
        <Languages aria-hidden className="h-4 w-4" />
        {copy.language}
      </h2>
      <p className="mt-1 mb-2 text-sm text-muted">{copy.languageHint}</p>
      <div role="radiogroup" aria-label={copy.language} className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
        {(Object.keys(copy.languageName) as Language[]).map((l) => (
          <label key={l} className="cursor-pointer">
            <input type="radio" name="language" className="peer sr-only" checked={language === l} onChange={() => choose(l)} />
            <span lang={l} className="block rounded-xl py-2 text-center text-sm peer-checked:bg-carbon peer-checked:font-bold peer-checked:text-on-carbon peer-focus-visible:outline-2 peer-focus-visible:outline-carbon">
              {copy.languageName[l]}
            </span>
          </label>
        ))}
      </div>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-error">
          {copy.actionFailed}
        </p>
      )}
    </div>
  );
}

// The viewer's webhook for the daily reminders: saved with PUT /api/v1/me/settings, tried with POST /api/v1/me/settings/test.
export function WebhookSettings({ webhookUrl }: { webhookUrl: string | null }) {
  const copy = useCopy();
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

// Sharing files: how on Android, and the iPhone's Zugang: the share address and the share key the Shortcut sends
// (POST/DELETE /api/v1/me/share-key), as one value. A new key is shown once, right after it was made.
export function ShareSettings({ hasKey, shareUrl }: { hasKey: boolean; shareUrl: string }) {
  const copy = useCopy();
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
      {/* The iPhone in the order it is set up: each step with what it needs right there. */}
      <h3 id="share-iphone" className="pt-2 font-bold">
        {copy.shareIphoneSetup}
      </h3>
      <ol aria-labelledby="share-iphone" className="list-decimal space-y-4 pl-5 marker:font-bold">
        <li className="space-y-2">
          <p>{copy.shareStepZugang}</p>
          {/* One value for the Shortcut's one question: it splits it at the space into the address and the key. */}
          {key && <CopyField label={copy.shareZugang} text={`${shareUrl} ${key}`} shown />}
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
        </li>
        <li className="space-y-2">
          <p>{copy.shareStepShortcut}</p>
          {/* The signed Shortcut (shortcut/source.ts): Safari on the iPhone hands it to the Kurzbefehle app. */}
          <a href="/shortcuts/An%20freundebuch.shortcut" download className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            <Download aria-hidden className="h-4 w-4" />
            {copy.shareShortcut}
          </a>
        </li>
      </ol>
      <h3 className="pt-2 font-bold">{copy.shareHowTo}</h3>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        {copy.shareHowToSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

// The calendar feed (POST/DELETE /api/v1/me/calendar-feed): a secret URL to subscribe to. A new one is shown once, right after
// it was made, with a webcal:// link that opens the phone's calendar app.
export function CalendarSettings({ hasFeed }: { hasFeed: boolean }) {
  const copy = useCopy();
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

// The weekly reflection (GET/PUT /api/v1/me/reflection): off, or a weekday and an hour. Saved on every change.
export function ReflectionSettings({ reflection, hasWebhook }: { reflection: { day: number; hour: number } | null; hasWebhook: boolean }) {
  const copy = useCopy();
  const [value, setValue] = useState(reflection);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: { day: number; hour: number } | null) {
    setValue(next);
    const res = await fetch("/api/v1/me/reflection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reflection: next }),
    }).catch(() => null);
    setStatus(res?.ok ? { ok: true, text: copy.saved } : { ok: false, text: copy.actionFailed });
  }

  const select = "rounded-xl border border-rule bg-surface-2 px-3 py-2 text-sm focus:border-carbon focus:outline-none";
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{copy.reflectionHint}</p>
      {!hasWebhook && <p className="text-muted">{copy.reflectionNeedsWebhook}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="reflection-day">
          {copy.reflectionDay}
        </label>
        <select
          id="reflection-day"
          value={value ? String(value.day) : "off"}
          onChange={(e) => save(e.target.value === "off" ? null : { day: Number(e.target.value), hour: value?.hour ?? 18 })}
          className={select}
        >
          <option value="off">{copy.reflectionOff}</option>
          {copy.weekdays.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        {value && (
          <>
            <label className="sr-only" htmlFor="reflection-hour">
              {copy.reflectionHour}
            </label>
            <select id="reflection-hour" value={value.hour} onChange={(e) => save({ day: value.day, hour: Number(e.target.value) })} className={select}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {`${String(h).padStart(2, "0")}:00`}
                </option>
              ))}
            </select>
          </>
        )}
        <span role="status" className={status?.ok === false ? "text-error" : "text-muted"}>
          {status?.text}
        </span>
      </div>
    </div>
  );
}
