"use client";

import { Bell, CalendarPlus, Check, Download, KeyRound, Languages, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Delivery, Kinds, Language, TodoistStatus } from "@/backend";
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
            <span
              lang={l}
              className="block rounded-xl py-2 text-center text-sm peer-checked:bg-carbon peer-checked:font-bold peer-checked:text-on-carbon peer-focus-visible:outline-2 peer-focus-visible:outline-carbon"
            >
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
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 text-sm font-bold text-on-carbon disabled:opacity-50"
        >
          <Check aria-hidden className="h-4 w-4" />
          {copy.save}
        </button>
        <button
          type="button"
          disabled={busy || !url.trim()}
          onClick={run(test)}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-4 py-1.5 text-sm font-bold disabled:opacity-50"
        >
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
          <a
            href="/shortcuts/An%20freundebuch.shortcut"
            download
            className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon"
          >
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

/**
 * What a days-ahead field does when it is left: an entry of 0-60 that differs from the saved value is sent once; an empty or invalid
 * one, or one the server refused, goes back to the saved value. Returns the value to show.
 */
export async function commitLeadDays(raw: string, saved: number, save: (n: number) => Promise<boolean>): Promise<number> {
  const text = raw.trim();
  const n = Number(text);
  if (text === "" || !Number.isInteger(n) || n < 0 || n > 60) return saved;
  if (n === saved) return saved;
  return (await save(n)) ? n : saved;
}

type Project = { id: string; name: string };
const KIND_ORDER = ["birthday", "anniversary", "date", "promise"] as const;
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Todoist: the token (PUT /api/v1/me/todoist, never shown again), the project, per kind the days ahead and where the date goes
// (PUT /me/todoist/kinds), and how reminders arrive (PUT /me/settings). The server falls back to the push when Todoist is not usable;
// this says so.
export function TodoistSettings({
  status,
  delivery,
  webhookUrl,
  projects: initialProjects,
}: {
  status: TodoistStatus;
  delivery: Delivery;
  webhookUrl: string | null;
  projects?: Project[];
}) {
  const hasWebhook = !!webhookUrl;
  const copy = useCopy();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(initialProjects ?? null);
  const [choice, setChoice] = useState("");
  const [kinds, setKinds] = useState<Kinds | null>(status.connected ? status.kinds : null);
  const [days, setDays] = useState<Record<string, string>>(
    status.connected ? Object.fromEntries(KIND_ORDER.map((k) => [k, String(status.kinds[k].leadDays)])) : {},
  );
  const [mode, setMode] = useState(delivery);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const needsProject = status.connected && !status.projectId;
  const usable = status.connected && !!status.projectId && !status.broken;
  const picking = status.connected && !status.broken && (needsProject || projects !== null);

  useEffect(() => {
    if (!needsProject || projects) return;
    fetch("/api/v1/me/todoist/projects")
      .then((r) => (r.ok ? (r.json() as Promise<Project[]>) : null))
      .then((p) => p && setProjects(p))
      .catch(() => {});
  }, [needsProject, projects]);

  const run = async (f: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await f();
    setBusy(false);
    return ok;
  };
  const report = (res: Response | null, refused?: string) =>
    setMessage(
      res?.ok
        ? { ok: true, text: copy.saved }
        : { ok: false, text: res?.status === 400 && refused ? refused : res?.status === 502 ? copy.todoistUnreachable : copy.actionFailed },
    );

  const connect = () =>
    run(async () => {
      const res = await fetch("/api/v1/me/todoist", json("PUT", { token: token.trim() })).catch(() => null);
      report(res, copy.todoistTokenRefused);
      if (!res?.ok) return false;
      setToken("");
      setProjects((await res.json()) as Project[]);
      router.refresh();
      return true;
    });
  const chooseProject = () =>
    run(async () => {
      const res = await fetch("/api/v1/me/todoist/project", json("PUT", { projectId: choice || projects?.[0]?.id })).catch(() => null);
      report(res);
      if (res?.ok) {
        setProjects(null);
        router.refresh();
      }
      return !!res?.ok;
    });
  // A kind is saved once, when its field is left (not per keystroke); an invalid entry or a refused save puts the last saved value back.
  const saveKind = async (kind: keyof Kinds, change: Partial<Kinds[keyof Kinds]>): Promise<boolean> => {
    if (!kinds) return false;
    const before = kinds;
    const next = { ...kinds, [kind]: { ...kinds[kind], ...change } };
    setKinds(next);
    const res = await fetch("/api/v1/me/todoist/kinds", json("PUT", { [kind]: next[kind] })).catch(() => null);
    report(res);
    if (!res?.ok) setKinds(before);
    return !!res?.ok;
  };
  const commitDays = async (kind: keyof Kinds) => {
    if (!kinds) return;
    const value = await commitLeadDays(days[kind] ?? "", kinds[kind].leadDays, (n) => saveKind(kind, { leadDays: n }));
    setDays((d) => ({ ...d, [kind]: String(value) }));
  };
  const disconnect = () =>
    run(async () => {
      const res = await fetch("/api/v1/me/todoist", { method: "DELETE" }).catch(() => null);
      report(res);
      if (res?.ok) router.refresh();
      return !!res?.ok;
    });
  // PUT /me/settings takes the whole settings: the webhook goes along unchanged.
  const chooseDelivery = async (next: Delivery) => {
    const before = mode;
    setMode(next);
    const res = await fetch("/api/v1/me/settings", json("PUT", { webhookUrl, delivery: next })).catch(() => null);
    report(res);
    if (!res?.ok) setMode(before);
  };
  const loadProjects = async () => {
    const res = await fetch("/api/v1/me/todoist/projects").catch(() => null);
    if (res?.ok) setProjects((await res.json()) as Project[]);
    else report(res);
  };

  const field = "rounded-xl border border-rule bg-surface-2 px-3 py-2 text-sm focus:border-carbon focus:outline-none";
  const button = "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold disabled:opacity-50";
  const tokenForm = (label: string) => (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      <label className="sr-only" htmlFor="todoist-token">
        {copy.todoistToken}
      </label>
      <input
        id="todoist-token"
        type="password"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={copy.todoistToken}
        className={`${field} min-w-0 flex-1`}
      />
      <button type="submit" disabled={busy || !token.trim()} className={`${button} bg-carbon text-on-carbon`}>
        <Check aria-hidden className="h-4 w-4" />
        {label}
      </button>
    </form>
  );

  const options: { value: Delivery; label: string }[] = [
    { value: "push", label: copy.deliveryPush },
    { value: "todoist", label: copy.deliveryTodoist },
    { value: "both", label: copy.deliveryBoth },
  ];

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">{copy.todoistHint}</p>
      {!status.connected && tokenForm(copy.todoistConnect)}
      {status.connected && status.broken && (
        <div className="space-y-2">
          <p role="alert" className="text-error">
            {copy.todoistBroken}
          </p>
          {tokenForm(copy.todoistReconnect)}
        </div>
      )}
      {usable && <p>{copy.todoistConnectedTo.replace("{project}", status.projectName ?? "")}</p>}
      {picking && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="todoist-project" className="font-bold">
            {copy.todoistChooseProject}
          </label>
          <select id="todoist-project" value={choice || projects?.[0]?.id || ""} onChange={(e) => setChoice(e.target.value)} className={field}>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy || !projects?.length} onClick={chooseProject} className={`${button} bg-carbon text-on-carbon`}>
            <Check aria-hidden className="h-4 w-4" />
            {copy.save}
          </button>
        </div>
      )}
      {usable && !picking && (
        <button type="button" onClick={loadProjects} className={`${button} bg-surface-2`}>
          {copy.todoistChangeProject}
        </button>
      )}
      {usable && kinds && (
        <ul className="space-y-2">
          {KIND_ORDER.map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <span className="w-32 font-bold">{copy.todoistKinds[k]}</span>
              <label className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={days[k] ?? ""}
                  onChange={(e) => setDays((d) => ({ ...d, [k]: e.target.value }))}
                  onBlur={() => commitDays(k)}
                  onKeyDown={(e) => e.key === "Enter" && commitDays(k)}
                  className={`${field} w-20`}
                />
                {copy.todoistDaysAhead}
              </label>
              <label className="sr-only" htmlFor={`placement-${k}`}>
                {copy.todoistPlacement}
              </label>
              <select
                id={`placement-${k}`}
                value={kinds[k].placement}
                onChange={(e) => saveKind(k, { placement: e.target.value as "due" | "deadline" })}
                className={field}
              >
                <option value="due">{copy.todoistAsDue}</option>
                <option value="deadline">{copy.todoistAsDeadline}</option>
              </select>
            </li>
          ))}
        </ul>
      )}
      {status.connected && (
        <button type="button" disabled={busy} onClick={disconnect} className={`${button} bg-surface-2`}>
          <Trash2 aria-hidden className="h-4 w-4" />
          {copy.todoistDisconnect}
        </button>
      )}
      <fieldset className="space-y-1 pt-2">
        <legend className="font-bold">{copy.deliveryTitle}</legend>
        {options.map((o) => {
          const off = o.value === "push" && !hasWebhook;
          return (
            <label key={o.value} className={`flex items-center gap-2 ${off ? "text-muted" : ""}`}>
              <input type="radio" name="delivery" value={o.value} checked={mode === o.value} disabled={off} onChange={() => chooseDelivery(o.value)} />
              {o.label}
            </label>
          );
        })}
        {!hasWebhook && <p className="text-muted">{copy.deliveryNeedsWebhook}</p>}
        {mode !== "push" && !usable && (
          <p data-testid="delivery-fallback" className="text-muted">
            {copy.deliveryFallback}
          </p>
        )}
      </fieldset>
      <p role="status" className={message?.ok === false ? "text-error" : "text-muted"}>
        {message?.text}
      </p>
    </div>
  );
}
