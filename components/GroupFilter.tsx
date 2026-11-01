"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCopy } from "@/components/i18n";

const KEY = "freundebuch.gruppe";

// Storage can be blocked or throw (private windows, cleared site data); the filter then just isn't remembered.
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (id: string | null) => {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
};

// The group chips above the orbit, one per group name across the books (`id` the name's key, `ids` its groups in each book).
// The choice lives in the URL (?gruppe=<key>) and is remembered on this device: opening the start
// page without one brings back the last group chosen here. Choosing the active group again clears the filter.
export function GroupFilter({ groups, current }: { groups: { id: string; ids?: string[]; name: string; count: number }[]; current: string | null }) {
  const copy = useCopy();
  const router = useRouter();
  useEffect(() => {
    if (current) return write(current);
    // A group remembered before the books merged is a group's id: it finds the group of its name.
    const last = read();
    const g = last && groups.find((x) => x.id === last || x.ids?.includes(last));
    if (g) router.replace(`/?gruppe=${encodeURIComponent(g.id)}`);
  }, [current, groups, router]);

  const chip = (on: boolean) =>
    `inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs ${on ? "bg-carbon font-semibold text-on-carbon" : "bg-surface-2 hover:bg-rule/60"}`;
  return (
    <nav aria-label={copy.groupFilter} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      <Link href="/" onClick={() => write(null)} aria-current={current === null ? "true" : undefined} className={chip(current === null)}>
        {copy.all}
      </Link>
      {groups.map((g) => (
        <Link
          key={g.id}
          href={current === g.id ? "/" : `/?gruppe=${encodeURIComponent(g.id)}`}
          onClick={() => current === g.id && write(null)}
          aria-current={current === g.id ? "true" : undefined}
          className={chip(current === g.id)}
        >
          {g.name}
          <span className="opacity-70 tabular-nums">{g.count}</span>
        </Link>
      ))}
    </nav>
  );
}
