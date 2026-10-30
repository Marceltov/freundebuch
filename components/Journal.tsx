import Link from "next/link";
import { Lock, Mic } from "lucide-react";
import type { JournalEntry } from "@/backend";
import type { Copy } from "@/components/copy";
import { getCopy } from "@/components/serverCopy";
import { shortDay } from "@/components/format";
import { ItemActions } from "@/components/ItemActions";

const monthYear = (copy: Copy, day: string) => new Intl.DateTimeFormat(copy.locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

// One journal entry: its day, its words, the people it names (links), the ramble it was told in, a lock while it is private, and
// its actions (edit, share or make private, delete) for the one who wrote it. `ramble`: false on the ramble's own page.
export function JournalItem({ e, ramble = true }: { e: JournalEntry; ramble?: boolean }) {
  const copy = getCopy();
  return (
    <li id={`journal-${e.id}`} className="rounded-2xl bg-surface p-3 shadow-card target:ring-2 target:ring-carbon">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">
          <b>{shortDay(copy, e.date)}</b>{" "}
          {e.visibility === "private" && <Lock aria-label={copy.journalPrivate} className="mb-0.5 inline h-3.5 w-3.5 text-muted" />} {e.text}
        </p>
        {e.mine && <ItemActions table="journal_entries" id={e.id} mine visibility={e.visibility} text={e.text} />}
      </div>
      {(e.people.length > 0 || ramble) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {e.people.map((p) => (
            <Link key={p.id} href={p.url} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-carbon hover:bg-rule">
              {p.name}
            </Link>
          ))}
          {ramble && (
            <Link href={`/r/${e.rambleId}`} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs hover:bg-rule">
              <Mic aria-hidden className="h-3 w-3" />
              {copy.ramble}
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

// The journal, newest first, by month.
export function Journal({ entries }: { entries: JournalEntry[] }) {
  const copy = getCopy();
  if (!entries.length) return <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.journalEmpty}</p>;
  const months = new Map<string, JournalEntry[]>();
  for (const e of entries) months.set(monthYear(copy, e.date), [...(months.get(monthYear(copy, e.date)) ?? []), e]);
  return (
    <>
      {[...months].map(([month, es]) => (
        <section key={month} className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold">{month}</h2>
          <ul className="space-y-2">
            {es.map((e) => (
              <JournalItem key={e.id} e={e} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
