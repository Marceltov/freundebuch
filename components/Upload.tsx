"use client";

import { Paperclip } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { copy } from "@/components/copy";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done"; n: number } | { kind: "failed" };

// Hochladen: files to keep, picked here and sent to POST /api/share one by one; they wait under Prüfen. Claude links here (the
// MCP tool inbox, action upload) when the user wants the originals of what they pasted into Claude kept.
export function Upload() {
  const picker = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function send(files: File[]) {
    if (!files.length) return;
    setState({ kind: "sending" });
    let n = 0;
    for (const f of files) {
      const form = new FormData();
      form.set("file", f, f.name);
      const res = await fetch("/api/share", { method: "POST", body: form }).catch(() => null);
      if (res?.status === 202) n++;
    }
    setState(n === files.length ? { kind: "done", n } : { kind: "failed" });
  }

  return (
    <section className="space-y-3 rounded-2xl bg-surface p-5 shadow-card">
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf,text/plain"
        multiple
        hidden
        onChange={(e) => {
          send([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={state.kind === "sending"}
        onClick={() => picker.current?.click()}
        className="inline-flex items-center gap-2 rounded-full bg-carbon px-4 py-2 font-bold text-on-carbon disabled:opacity-50"
      >
        <Paperclip aria-hidden className="h-4 w-4" />
        {copy.uploadPick}
      </button>
      {state.kind !== "idle" && (
        <p role="status" className={state.kind === "failed" ? "text-error" : ""}>
          {state.kind === "sending" ? copy.uploadSending : state.kind === "failed" ? copy.uploadFailed : state.n === 1 ? copy.uploadOne : copy.uploadDone.replace("{n}", String(state.n))}
        </p>
      )}
      {state.kind === "done" && (
        <Link href="/pruefen" className="inline-block rounded-full bg-surface-2 px-4 py-1.5 text-sm font-bold">
          {copy.pending} ›
        </Link>
      )}
    </section>
  );
}
