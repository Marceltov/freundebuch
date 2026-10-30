"use client";

import { FileText, MessageCirclePlus, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PendingFile } from "@/backend";
import { copy } from "@/components/copy";
import { tellAbout } from "@/components/TabBar";

// The "Prüfen" list: each waiting file with what Claude suggests to file and who is in it. Filing happens with Claude: "In
// Erzählen öffnen" opens the chat on the file; throwing away goes through DELETE /api/v1/files/{id}, reading again …/retry.
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
      <FileText aria-hidden className="h-7 w-7 text-carbon" />
      {item.type === "application/pdf" ? copy.filePdf : copy.fileText}
    </a>
  );
}

function PendingCard({ item, onDone }: { item: PendingFile; onDone: () => void }) {
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
    <article className="flex gap-3 rounded-2xl bg-surface p-4 shadow-card">
      <FilePreview item={item} />
      <div className="min-w-0 flex-1 space-y-2">
        {item.status === "reading" && <p className="text-muted">{copy.pendingReading}</p>}
        {item.status === "failed" && (
          <>
            <p className="text-error">{copy.pendingFailed}</p>
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
