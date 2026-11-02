"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/components/i18n";

// On a person's page: someone of the user's other books goes by the same name. Only the user can say whether they are one
// person (ADR 0029): yes links them, no is kept so the page and Claude don't ask again. Either way the page reloads.
export function SameAsk({
  personId,
  name,
  book,
  matches,
}: {
  personId: string;
  name: string;
  book: string;
  matches: { id: string; name: string; book: { id: string; name: string } }[];
}) {
  const copy = useCopy();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  async function answer(path: "link" | "not-same", other: string) {
    setFailed(false);
    const res = await fetch(`/api/v1/people/${personId}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ with: other }),
    }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    router.refresh();
  }
  return (
    <div className="mt-3 space-y-2">
      {matches.map((m) => (
        <div key={m.id} role="group" className="rounded-2xl bg-surface-2 p-3 text-sm">
          <p>{copy.sameAsk.replace("{name}", name).replace("{book}", book).replace("{other}", m.name).replace("{otherBook}", m.book.name)}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => answer("link", m.id)} className="rounded-full bg-carbon px-3 py-1 font-semibold text-on-carbon">
              {copy.sameYes}
            </button>
            <button type="button" onClick={() => answer("not-same", m.id)} className="rounded-full bg-surface px-3 py-1 font-semibold">
              {copy.sameNo}
            </button>
          </div>
        </div>
      ))}
      {failed && (
        <p role="alert" className="text-sm text-error">
          {copy.actionFailed}
        </p>
      )}
    </div>
  );
}
