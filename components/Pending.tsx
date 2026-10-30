"use client";

import { AudioLines, FileText, MessageCirclePlus, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PendingFile } from "@/backend";
import { copy } from "@/components/copy";
import { tellAbout } from "@/components/TabBar";

// The "Prüfen" list: each waiting file with what Claude suggests to file and who is in it. Filing happens with Claude: "In
// Erzählen öffnen" opens the chat on the file; throwing away goes through DELETE /api/v1/files/{id}, reading again …/retry.
// Files can be selected: several are worked through together in one chat ("Zusammen prüfen") or thrown away at once. Files
// shared together (same batchId) sit in one group, and opening the page on one of them (#id, as the Shortcut does) selects
// the whole group.
export function PendingList({ items }: { items: PendingFile[] }) {
  const router = useRouter();
  const reading = items.some((i) => i.status === "reading");
  // What the user ticked; until they tick anything, the file the page was opened on (#id) and the files shared with it.
  // Opened again on another file (a new #id), what was ticked before no longer counts.
  const [ticked, setTicked] = useState<{ hash: string; ids: Set<string> } | null>(null);
  const hash = useSyncExternalStore(onHashChange, () => idOfHash(window.location.hash), () => "");
  const target = items.find((i) => i.id === hash);
  const selected = ticked?.hash === hash ? ticked.ids : new Set(target ? (target.batchId ? items.filter((i) => i.batchId === target.batchId).map((i) => i.id) : [target.id]) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  // While Claude is still reading one, look again every few seconds.
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [reading, router]);
  useEffect(() => {
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "center" });
  }, [hash]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setTicked({ hash, ids: next });
  };
  // In list order, which is the order they were shared in within a group.
  const chosen = items.filter((i) => selected.has(i.id)).map((i) => i.id);

  async function discardChosen() {
    if (!window.confirm(copy.discardSelectedConfirm.replace("{n}", String(chosen.length)))) return;
    setBusy(true);
    setError(false);
    const results = await Promise.all(chosen.map((id) => fetch(`/api/v1/files/${id}`, { method: "DELETE" }).catch(() => null)));
    setBusy(false);
    if (results.some((r) => !r?.ok)) setError(true);
    setTicked({ hash, ids: new Set() });
    router.refresh();
  }

  // Consecutive files of one batch form a group (listPending puts them side by side).
  const groups: PendingFile[][] = [];
  for (const i of items) {
    const last = groups.at(-1);
    if (i.batchId && last?.[0].batchId === i.batchId) last.push(i);
    else groups.push([i]);
  }
  const card = (i: PendingFile) => (
    <li key={i.id} id={i.id}>
      <PendingCard item={i} selected={selected.has(i.id)} onSelect={(on) => toggle(i.id, on)} onDone={() => router.refresh()} />
    </li>
  );
  return (
    <div className="space-y-3">
      {chosen.length > 1 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-surface p-3 shadow-float">
          <button type="button" onClick={() => tellAbout(chosen)} className={`${button} bg-carbon text-on-carbon`}>
            <MessageCirclePlus aria-hidden className="h-4 w-4" />
            {copy.reviewTogether.replace("{n}", String(chosen.length))}
          </button>
          <button type="button" disabled={busy} onClick={discardChosen} className={`${button} bg-surface-2`}>
            <Trash2 aria-hidden className="h-4 w-4" />
            {copy.discardSelected.replace("{n}", String(chosen.length))}
          </button>
          {error && (
            <p role="status" className="text-sm text-error">
              {copy.actionFailed}
            </p>
          )}
        </div>
      )}
      <ul className="space-y-3">
        {groups.map((g) =>
          g.length > 1 ? (
            <li key={g[0].batchId} data-batch={g[0].batchId} className="space-y-2 rounded-3xl border border-rule p-2">
              <p className="px-2 text-xs font-bold text-muted">{copy.sharedTogether}</p>
              <ul className="space-y-2">{g.map(card)}</ul>
            </li>
          ) : (
            card(g[0])
          ),
        )}
      </ul>
    </div>
  );
}

/** The file id in a link to Prüfen (#id); ids need no decoding, and a broken one opens on nothing rather than failing. */
export const idOfHash = (hash: string): string => (/^#[A-Za-z0-9_-]+$/.test(hash) ? hash.slice(1) : "");

const onHashChange = (then: () => void) => {
  window.addEventListener("hashchange", then);
  return () => window.removeEventListener("hashchange", then);
};

const button = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold disabled:opacity-50";

/** The file at a glance: an image's preview, else an icon with its kind. */
export function FilePreview({ item }: { item: Pick<PendingFile, "url" | "type"> }) {
  if (item.type.startsWith("image/"))
    return (
      <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind the sign-in, not for next/image */}
        <img src={item.url} alt={copy.fileImage} className="h-32 w-20 rounded-lg bg-surface-2 object-cover object-top" />
      </a>
    );
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="flex h-32 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg bg-surface-2 text-xs text-muted">
      {item.type.startsWith("audio/") ? <AudioLines aria-hidden className="h-7 w-7 text-carbon" /> : <FileText aria-hidden className="h-7 w-7 text-carbon" />}
      {item.type.startsWith("audio/") ? copy.fileAudio : item.type === "application/pdf" ? copy.filePdf : copy.fileText}
    </a>
  );
}

function PendingCard({ item, selected, onSelect, onDone }: { item: PendingFile; selected: boolean; onSelect: (on: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function act(path: string, method: string) {
    setBusy(true);
    setError(false);
    const res = await fetch(`/api/v1/files/${item.id}${path}`, { method }).catch(() => null);
    setBusy(false);
    if (res?.ok) onDone();
    else setError(true);
  }

  const discard = (
    <button type="button" disabled={busy} onClick={() => act("", "DELETE")} className={`${button} bg-surface-2`}>
      <Trash2 aria-hidden className="h-4 w-4" />
      {copy.pendingDiscard}
    </button>
  );
  return (
    <article className={`flex gap-3 rounded-2xl bg-surface p-4 shadow-card ${selected ? "ring-2 ring-carbon" : ""}`}>
      <input type="checkbox" aria-label={copy.selectFile} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-carbon" />
      <FilePreview item={item} />
      <div className="min-w-0 flex-1 space-y-2">
        {/* Kept only until it is filed, like every shared file; then only its transcript remains. */}
        {item.type.startsWith("audio/") && <audio controls preload="none" src={item.url} className="w-full" />}
        {item.status === "reading" && <p className="text-muted">{copy.pendingReading}</p>}
        {item.status === "failed" && (
          <>
            <p className="text-error">{item.type.startsWith("audio/") && !item.transcript ? copy.pendingNotTranscribed : copy.pendingFailed}</p>
            {item.error && <p className="text-xs break-words text-muted">{item.error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => act("/retry", "POST")} className={`${button} bg-carbon text-on-carbon`}>
                <RotateCw aria-hidden className="h-4 w-4" />
                {copy.pendingRetry}
              </button>
              {discard}
            </div>
          </>
        )}
        {item.status === "pending" && (
          <>
            <p className="whitespace-pre-line">{item.summary}</p>
            {item.people.length > 0 && <p className="text-sm text-muted">{item.people.map((p) => p.person?.name ?? p.name).join(", ")}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => tellAbout([item.id])} className={`${button} bg-carbon text-on-carbon`}>
                <MessageCirclePlus aria-hidden className="h-4 w-4" />
                {copy.pendingTell}
              </button>
              {discard}
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
