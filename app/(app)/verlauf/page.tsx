import Link from "next/link";
import { BookOpen, Coffee, Lock, NotebookPen, Ticket } from "lucide-react";
import { listRambles, today, type RambleSummary } from "@/backend";
import { copy, kindName } from "@/components/copy";
import { shortDay } from "@/components/format";
import { KIND_ICON } from "@/components/icons";
import { pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.tabHistory };

// Monday of the week a day is in, as days since 1970 (UTC calendar days, like everywhere in the app).
const mondayOf = (day: string) => {
  const t = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  return t - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7);
};
const monthYear = (day: string) =>
  new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

// Every ramble the viewer may see a part of, newest first: this week, last week, then by month. A ramble shows its conversations,
// each linking to its page, where what Claude filed can be checked and fixed, and its journal entries the viewer may see; a
// ramble told in parts links to its own page.
export default async function HistoryPage() {
  const v = await pageViewer();
  const now = today();
  const rambles = await listRambles(v);
  const thisWeek = mondayOf(now);
  const heading = (day: string) => {
    const weeks = (thisWeek - mondayOf(day)) / 7;
    return weeks <= 0 ? copy.thisWeek : weeks === 1 ? copy.lastWeek : monthYear(day);
  };
  const groups = new Map<string, typeof rambles>();
  for (const r of rambles) groups.set(heading(r.date), [...(groups.get(heading(r.date)) ?? []), r]);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{copy.tabHistory}</h1>
        <Link href="/tagebuch" className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold text-carbon hover:bg-rule">
          <NotebookPen aria-hidden className="h-4 w-4" />
          {copy.journal}
        </Link>
      </div>
      {rambles.length === 0 && <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.nothingFiled}</p>}
      {[...groups].map(([title, rs]) => (
        <section key={title} className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold">{title}</h2>
          <ul className="space-y-2">
            {rs.map((r) => (
              <li key={r.id} data-ramble={r.id}>
                <ul className={r.conversations.length + r.experiences.length + r.journal.length + (r.items.length ? 1 : 0) > 1 ? "space-y-1 rounded-3xl border border-rule p-1" : ""}>
                  {r.experiences.map((e) => (
                    <li key={e.id}>
                      <Link href={e.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
                          <Ticket aria-label={e.kind} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-semibold">
                            {shortDay(e.date)} · {e.title}
                            {e.visibility === "private" && <Lock aria-label={copy.journalPrivate} className="h-3.5 w-3.5 text-muted" />}
                          </span>
                          <span className="line-clamp-2 block text-sm text-muted">{[e.kind, e.series?.name, e.place?.name].filter(Boolean).join(" · ")}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                  {r.conversations.map((c) => (
                    <ConversationRow key={c.id} c={c} />
                  ))}
                  {r.journal.map((e) => (
                    <li key={e.id}>
                      <Link href={r.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
                          <NotebookPen aria-label={copy.journal} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 font-semibold">
                            {shortDay(e.date)} · {copy.journal}
                            {e.visibility === "private" && <Lock aria-label={copy.journalPrivate} className="h-3.5 w-3.5 text-muted" />}
                          </span>
                          <span className="line-clamp-2 block text-sm text-muted">{e.text}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                  {r.items.length > 0 && (
                    <li>
                      <Link href={r.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
                          <BookOpen aria-label={copy.rambleItems} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {shortDay(r.date)} · {[...new Set(r.items.map((x) => x.person.name))].join(", ")}
                          </span>
                          <span className="line-clamp-2 block text-sm text-muted">{r.items.map((x) => x.text).join(" · ")}</span>
                        </span>
                      </Link>
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ConversationRow({ c }: { c: RambleSummary["conversations"][number] }) {
  const Icon = KIND_ICON[c.kind] ?? Coffee;
  return (
    <li key={c.id}>
      <Link href={c.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
        <span title={kindName[c.kind]} className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
          <Icon aria-label={kindName[c.kind]} className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {shortDay(c.date)}
            {c.people.length > 0 && ` · ${c.people.map((p) => p.name).join(", ")}`}
          </span>
          <span className="line-clamp-2 block text-sm text-muted">{c.summary}</span>
        </span>
      </Link>
    </li>
  );
}
