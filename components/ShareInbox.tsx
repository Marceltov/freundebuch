"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCopy } from "@/components/i18n";

const INBOX = "freundebuch-share-inbox"; // as in public/sw.js

type State = "receiving" | "received" | "duplicate" | "failed" | "empty";

// Sends what the service worker put into the inbox to POST /api/share, one file at a time, empties it and goes on to Prüfen.
export function ShareInbox({ again }: { again: boolean }) {
  const copy = useCopy();
  const [state, setState] = useState<State>(again ? "failed" : "receiving");
  useEffect(() => {
    if (again) return;
    (async () => {
      if (!("caches" in window)) return setState("empty");
      const cache = await caches.open(INBOX);
      const keys = await cache.keys();
      if (!keys.length) return setState("empty");
      let result: State = "received";
      let last: string | null = null;
      // Several files shared in one go carry one batch id, so Prüfen shows them together and pre-selected.
      const batch = keys.length > 1 ? `share-${crypto.randomUUID()}` : null;
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const form = new FormData();
        form.set("file", blob, "geteilt");
        const up = await fetch("/api/share", { method: "POST", body: form, headers: batch ? { "x-freundebuch-batch": batch } : undefined }).catch(() => null);
        if (!up || up.status !== 202) {
          result = "failed";
          continue;
        }
        const body = (await up.json()) as { id: string; duplicate: boolean };
        last = body.id;
        if (body.duplicate && result === "received") result = "duplicate";
        await cache.delete(req);
      }
      // Arrived: on to where it waits.
      if (result !== "failed" && last) return window.location.replace(`/pruefen#${last}`);
      setState(result);
    })().catch(() => setState("failed"));
  }, [again]);

  const text = { receiving: copy.shareReceiving, received: copy.shareReceived, duplicate: copy.shareDuplicate, failed: copy.shareFailed, empty: copy.shareNothing }[state];
  return (
    <section className="space-y-3 rounded-2xl bg-surface p-5 shadow-card">
      <p role="status" className={state === "failed" ? "text-error" : ""}>
        {text}
      </p>
      {state !== "receiving" && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/" className="rounded-full bg-carbon px-4 py-1.5 font-bold text-on-carbon">
            {copy.home}
          </Link>
          <Link href="/pruefen" className="rounded-full bg-surface-2 px-4 py-1.5 font-bold">
            {copy.pending}
          </Link>
          {state === "empty" && (
            <Link href="/einstellungen#teilen" className="rounded-full bg-surface-2 px-4 py-1.5 font-bold">
              {copy.settings}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
