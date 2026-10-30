"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useCopy } from "@/components/i18n";

// Copies `text` to the clipboard; the icon turns into a tick once it is there.
export function CopyButton({ text }: { text: string }) {
  const copy = useCopy();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const label = state === "copied" ? copy.copied : state === "failed" ? copy.copyFailed : copy.copyText;
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule/60"
    >
      {state === "copied" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
    </button>
  );
}

/** A URL to copy: the address itself, in a box that scrolls rather than widens the page, and the button. */
/** A value to copy; `shown` puts its label above it, where the user needs to know which value is which. */
export function CopyField({ label, text, shown = false }: { label: string; text: string; shown?: boolean }) {
  const field = (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 py-1 pr-1 pl-3">
      {!shown && <span className="sr-only">{label}</span>}
      <code className="min-w-0 flex-1 overflow-x-auto py-1.5 text-sm whitespace-nowrap">{text}</code>
      <CopyButton text={text} />
    </div>
  );
  if (!shown) return field;
  return (
    <div className="space-y-1">
      <p className="text-xs font-bold text-muted">{label}</p>
      {field}
    </div>
  );
}
