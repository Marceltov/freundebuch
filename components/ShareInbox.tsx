"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { copy } from "@/components/copy";

const INBOX = "freundebuch-share-inbox"; // as in public/sw.js

type State = "receiving" | "received" | "duplicate" | "failed" | "empty";

// Sends what the service worker put into the inbox to POST /api/share, one image at a time, and empties it.
export function ShareInbox({ again }: { again: boolean }) {
  const [state, setState] = useState<State>(again ? "failed" : "receiving");
  useEffect(() => {
    if (again) return;
    (async () => {
      if (!("caches" in window)) return setState("empty");
      const cache = await caches.open(INBOX);
      const keys = await cache.keys();
      if (!keys.length) return setState("empty");
      let result: State = "received";
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const form = new FormData();
        form.set("image", blob, "screenshot");
        const up = await fetch("/api/share", { method: "POST", body: form }).catch(() => null);
        if (!up || up.status !== 202) {
          result = "failed";
          continue;
        }
        if (((await up.json()) as { duplicate: boolean }).duplicate && result === "received") result = "duplicate";
        await cache.delete(req);
      }
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
