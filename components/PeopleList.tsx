"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useState } from "react";
import { copy } from "@/components/copy";
import { Face } from "@/components/Face";
import { groupTint } from "@/components/Tiles";

/** `household`: the partner's own person, who belongs to no group but isn't missing one. */
export type PersonRow = { id: string; name: string; aliases: string[]; url: string; seen: string; groups: string[]; household: boolean };

/** The chip for the people in no group. */
export const NO_GROUP = "none";

/** Whether the person shows under the chip `group`: every one for none chosen, else its members, or with NO_GROUP those in none. */
export const inGroup = (p: PersonRow, group: string | null) =>
  !group || (group === NO_GROUP ? !p.groups.length && !p.household : p.groups.includes(group));

// Lower case, without accents and umlaut dots, so "lea" finds "Léa" and "muller" finds "Müller".
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss");

// Leute: everyone, A to Z under their first letter, with a search over names and nicknames and the group chips to narrow it,
// the last of them for the people in no group yet.
export function PeopleList({ people, groups }: { people: PersonRow[]; groups: { id: string; name: string; count: number }[] }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const n = fold(q.trim());
  const shown = people.filter((p) => inGroup(p, group) && (!n || [p.name, ...p.aliases].some((x) => fold(x).includes(n))));
  const ungrouped = people.filter((p) => inGroup(p, NO_GROUP)).length;
  const letters = new Map<string, PersonRow[]>();
  for (const p of shown) {
    const l = fold(p.name).charAt(0).toUpperCase() || "#";
    letters.set(l, [...(letters.get(l) ?? []), p]);
  }
  return (
    <>
      <label className="mt-3 flex items-center gap-2 rounded-2xl border-2 border-rule bg-surface px-3 py-2.5 focus-within:border-carbon">
        <Search aria-hidden className="h-5 w-5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={copy.search} placeholder={copy.searchPeople} className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
      {groups.length > 0 && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {[{ id: null, name: copy.all, count: people.length }, ...groups, ...(ungrouped ? [{ id: NO_GROUP, name: copy.noGroup, count: ungrouped }] : [])].map((g) => (
            <button
              key={g.id ?? "all"}
              type="button"
              aria-pressed={group === g.id}
              onClick={() => setGroup(group === g.id ? null : g.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs ${group === g.id ? "bg-carbon font-bold text-on-carbon" : g.id && g.id !== NO_GROUP ? groupTint(g.id) : "bg-surface-2"}`}
            >
              {g.name} <span className="tabular-nums opacity-70">{g.count}</span>
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="mt-6 text-muted">{people.length ? copy.noMatch : copy.nobodyYet}</p>
      ) : (
        [...letters].map(([l, ps]) => (
          <section key={l} aria-label={l} className="mt-4">
            <h2 className="font-display text-base font-extrabold text-carbon">{l}</h2>
            <ul>
              {ps.map((p) => (
                <li key={p.id}>
                  <Link href={p.url} className="flex items-center gap-3 rounded-2xl px-1 py-2 hover:bg-surface">
                    <Face id={p.id} name={p.name} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg leading-tight font-semibold">{p.name}</span>
                      <span className="block text-sm text-muted">{p.seen}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
