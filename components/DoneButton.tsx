"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/components/i18n";

// A box to tick a promise off where it is listed: PATCH done, then the page reloads without it.
export function DoneButton({ id, text }: { id: string; text: string }) {
  const copy = useCopy();
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <button
      type="button"
      aria-label={copy.markDone.replace("{text}", text)}
      title={state === "failed" ? copy.actionFailed : copy.done}
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        const res = await fetch(`/api/v1/items/promises/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ done: true }),
        }).catch(() => null);
        if (!res?.ok) return setState("failed");
        router.refresh();
      }}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 ${state === "failed" ? "border-error" : "border-carbon"} text-carbon hover:bg-carbon/10`}
    >
      {state === "busy" && <Check aria-hidden className="h-4 w-4" />}
    </button>
  );
}
