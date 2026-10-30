"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCopy } from "@/components/i18n";

// The search field on Verlauf: what is typed goes into ?q= after a short pause, and the page shows what holds every word.
export function HistorySearch({ query }: { query: string }) {
  const copy = useCopy();
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const go = (next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.replace(next.trim() ? `${path}?q=${encodeURIComponent(next.trim())}` : path, { scroll: false }), 250);
  };
  return (
    <label className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-rule bg-surface px-3 py-2.5 focus-within:border-carbon">
      <Search aria-hidden className="h-5 w-5 text-muted" />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          go(e.target.value);
        }}
        aria-label={copy.searchHistory}
        placeholder={copy.searchHistoryHint}
        className="min-w-0 flex-1 bg-transparent outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          aria-label={copy.clearSearch}
          onClick={() => {
            setQ("");
            go("");
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}
