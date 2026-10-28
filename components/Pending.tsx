"use client";

import { Check, Lock, RotateCw, Search, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PendingFile } from "@/backend";
import { copy } from "@/components/copy";
import { dayMonth } from "@/components/format";

type Pick = { personId: string; name: string } | { newName: string };

// The "Zu prüfen" list: each waiting screenshot with what Claude read, and the choice of person. Filing goes through
// POST /api/v1/screenshots/{id}/resolve, throwing away through DELETE, reading again through …/retry.
export function PendingList({ items }: { items: PendingFile[] }) {
  const router = useRouter();
  const reading = items.some((i) => i.status === "reading");
  // While Claude is still reading one, look again every few seconds.
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [reading, router]);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id} id={i.id}>
          <PendingCard item={i} onDone={() => router.refresh()} />
        </li>
      ))}
    </ul>
  );
}

const button = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold disabled:opacity-50";

function PendingCard({ item, onDone }: { item: PendingFile; onDone: () => void }) {
  const r = item.reading;
  const first = r?.people[0];
  const [pick, setPick] = useState<Pick | null>(first?.candidates.length === 1 ? { personId: first.candidates[0].id, name: first.candidates[0].name } : null);
  const [text, setText] = useState(r?.text ?? "");
  const [priv, setPriv] = useState(!!r?.sensitive);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const t = setTimeout(async () => {
      const res = await fetch(`/api/v1/people?q=${encodeURIComponent(q)}`).catch(() => null);
      setFound(res?.ok ? ((await res.json()) as { id: string; name: string }[]) : []);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function act(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/v1/screenshots/${item.id}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDone();
    else setError(true);
  }

  const file = () =>
    pick && act("/resolve", "POST", { ...("personId" in pick ? { personId: pick.personId } : { name: pick.newName }), text, visibility: priv ? "private" : "shared" });
  const pickName = pick && ("personId" in pick ? pick.name : pick.newName);
  const candidates = [...new Map((r?.people ?? []).flatMap((p) => p.candidates).map((c) => [c.id, c])).values()];
  const newName = query.trim() || first?.name || "";

  return (
    <article className="flex gap-3 rounded-2xl bg-surface p-4 shadow-card">
      <a href={item.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind the sign-in, not for next/image */}
        <img src={item.imageUrl} alt={copy.screenshot} className="h-32 w-20 rounded-lg bg-surface-2 object-cover object-top" />
      </a>
      <div className="min-w-0 flex-1 space-y-2">
        {item.status === "reading" && <p className="text-muted">{copy.pendingReading}</p>}
        {item.status === "failed" && (
          <>
            <p className="text-error">{copy.pendingFailed}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => act("/retry", "POST")} className={`${button} bg-carbon text-on-carbon`}>
                <RotateCw aria-hidden className="h-4 w-4" />
                {copy.pendingRetry}
              </button>
              <button type="button" disabled={busy} onClick={() => act("", "DELETE")} className={`${button} bg-surface-2`}>
                <Trash2 aria-hidden className="h-4 w-4" />
                {copy.pendingDiscard}
              </button>
            </div>
          </>
        )}
        {item.status === "pending" && r && (
          <>
            <p className="text-sm text-muted">
              {[r.people.map((p) => p.name + (p.handle ? ` (@${p.handle})` : "")).join(", "), r.platform, r.happenedOn && dayMonth(r.happenedOn)].filter(Boolean).join(" · ")}
            </p>
            <label className="block text-sm">
              <span className="sr-only">{copy.pendingText}</span>
              <input value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-xl border border-rule bg-surface-2 px-3 py-2 focus:border-carbon focus:outline-none" />
            </label>
            {r.sensitive && <p className="text-sm text-error">{copy.pendingSensitive}</p>}
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold">{copy.pendingWho}</legend>
              <div className="flex flex-wrap gap-2">
                {[...candidates, ...(query.trim() ? found : []).filter((f) => !candidates.some((c) => c.id === f.id))].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={!!pick && "personId" in pick && pick.personId === c.id}
                    onClick={() => setPick({ personId: c.id, name: c.name })}
                    className={`${button} ${pick && "personId" in pick && pick.personId === c.id ? "bg-carbon text-on-carbon" : "bg-surface-2"}`}
                  >
                    {c.name}
                  </button>
                ))}
                {newName && (
                  <button
                    type="button"
                    aria-pressed={!!pick && "newName" in pick}
                    onClick={() => setPick({ newName })}
                    className={`${button} ${pick && "newName" in pick ? "bg-carbon text-on-carbon" : "bg-surface-2"}`}
                  >
                    <UserPlus aria-hidden className="h-4 w-4" />
                    {copy.pendingNew.replace("{name}", newName)}
                  </button>
                )}
              </div>
              <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm">
                <Search aria-hidden className="h-4 w-4 text-muted" />
                <span className="sr-only">{copy.pendingSearch}</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.pendingSearch} className="min-w-0 flex-1 bg-transparent focus:outline-none" />
              </label>
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              <Lock aria-hidden className="h-3.5 w-3.5" />
              {copy.pendingPrivate}
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !pick || !text.trim()} onClick={file} className={`${button} bg-carbon text-on-carbon`}>
                <Check aria-hidden className="h-4 w-4" />
                {pickName ? copy.pendingFile.replace("{name}", pickName) : copy.pendingWho}
              </button>
              <button type="button" disabled={busy} onClick={() => act("", "DELETE")} className={`${button} bg-surface-2`}>
                <Trash2 aria-hidden className="h-4 w-4" />
                {copy.pendingDiscard}
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="status" className="text-sm text-error">
            {copy.actionFailed}
          </p>
        )}
      </div>
    </article>
  );
}
