"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { copy } from "@/components/copy";

// Deletes a ramble with everything told in it (DELETE /api/v1/rambles/{id}), for its recorder; asks once more first, then
// goes back to Verlauf.
export function RambleDelete({ id }: { id: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    const res = await fetch(`/api/v1/rambles/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    router.push("/verlauf");
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        onClick={asking ? remove : () => setAsking(true)}
        className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-bold ${asking ? "bg-error text-white" : "bg-surface-2"}`}
      >
        <Trash2 aria-hidden className="h-4 w-4" />
        {asking ? copy.confirmRemove : copy.rambleRemove}
      </button>
      {failed && (
        <span role="status" className="text-error">
          {copy.actionFailed}
        </span>
      )}
    </div>
  );
}
