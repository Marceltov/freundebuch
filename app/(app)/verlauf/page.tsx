import Link from "next/link";
import { BookOpen, Cake, Coffee, Gift, Info, Lock, MapPin, MessageSquareText, NotebookPen, Pin, Ticket, type LucideIcon } from "lucide-react";
import { listRambles, markMatches, search, today, type RambleSummary, type SearchHit } from "@/backend";
import type { Copy } from "@/components/copy";
import { getCopy } from "@/components/serverCopy";
import { shortDay } from "@/components/format";
import { HistorySearch } from "@/components/HistorySearch";
import { KIND_ICON } from "@/components/icons";
import { pageCopy, pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).tabHistory });

// Monday of the week a day is in, as days since 1970 (UTC calendar days, like everywhere in the app).
const mondayOf = (day: string) => {
  const t = Date.parse(`${day}T00:00:00Z`) / 86_400_000;
  return t - ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7);
};
const monthYear = (copy: Copy, day: string) =>
  new Intl.DateTimeFormat(copy.locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));

// Every ramble the viewer may see a part of, newest first: this week, last week, then by month. A ramble shows its conversations,
// each linking to its page, where what Claude filed can be checked and fixed, and its journal entries the viewer may see; a
// ramble told in parts links to its own page. With a search (?q=), what holds every word instead, the words marked.
export default async function HistoryPage({ searchParams }: PageProps<"/verlauf">) {
  const v = await pageViewer();
  const copy = getCopy();
  const q = (await searchParams).q;
  const query = typeof q === "string" ? q.trim() : "";
  const now = today();
  const rambles = await listRambles(v);
  const thisWeek = mondayOf(now);
  const heading = (day: string) => {
    const weeks = (thisWeek - mondayOf(day)) / 7;
    return weeks <= 0 ? copy.thisWeek : weeks === 1 ? copy.lastWeek : monthYear(copy, day);
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
      {rambles.length > 0 && <HistorySearch query={query} />}
      {query ? (
        <Hits query={query} hits={await search(v, query)} />
      ) : (
        <>
          {rambles.length === 0 && <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.nothingFiled}</p>}
          {[...groups].map(([title, rs]) => (
            <section key={title} className="mt-6">
              <h2 className="mb-2 font-display text-lg font-semibold">{title}</h2>
              <ul className="space-y-2">
                {rs.map((r) => (
                  <li key={r.id} data-ramble={r.id}>
                    <ul
                      className={
                        r.conversations.length + r.experiences.length + r.journal.length + (r.items.length ? 1 : 0) > 1
                          ? "space-y-1 rounded-3xl border border-rule p-1"
                          : ""
                      }
                    >
                      {r.experiences.map((e) => (
                        <li key={e.id}>
                          <Link href={e.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
                              <Ticket aria-label={e.kind} className="h-[18px] w-[18px]" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1 font-semibold">
                                {shortDay(copy, e.date)} · {e.title}
                                {e.visibility === "private" && <Lock aria-label={copy.journalPrivate} className="h-3.5 w-3.5 text-muted" />}
                              </span>
                              <span className="line-clamp-2 block text-sm text-muted">
                                {[e.kind, e.series?.name, e.place?.name].filter(Boolean).join(" · ")}
                              </span>
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
                                {shortDay(copy, e.date)} · {copy.journal}
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
                                {shortDay(copy, r.date)} · {[...new Set(r.items.map((x) => x.person.name))].join(", ")}
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
        </>
      )}
    </div>
  );
}

const HIT_ICON: Record<SearchHit["kind"], LucideIcon> = {
  transcript: MessageSquareText,
  conversation: Coffee,
  experience: Ticket,
  journal: NotebookPen,
  fact: Info,
  promise: Pin,
  exchange: Gift,
  date: Cake,
  place: MapPin,
};

function Hits({ query, hits }: { query: string; hits: SearchHit[] }) {
  const copy = getCopy();
  if (!hits.length) return <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.searchNothing.replace("{q}", query)}</p>;
  return (
    <ul aria-label={copy.searchFound} className="mt-4 space-y-2">
      {hits.map((h) => {
        const Icon = HIT_ICON[h.kind];
        return (
          <li key={`${h.kind}-${h.id}`}>
            <Link href={h.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
                <Icon aria-label={copy.searchKind[h.kind]} className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {[h.date && shortDay(copy, h.date), copy.searchKind[h.kind], h.people.join(", ")].filter(Boolean).join(" · ")}
                </span>
                <span className="line-clamp-3 block text-sm text-muted">
                  {markMatches(h.text, query).map((piece, i) =>
                    piece.mark ? (
                      <mark key={i} className="rounded bg-drift/30 px-0.5 text-ink">
                        {piece.text}
                      </mark>
                    ) : (
                      piece.text
                    ),
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ConversationRow({ c }: { c: RambleSummary["conversations"][number] }) {
  const copy = getCopy();
  const Icon = KIND_ICON[c.kind] ?? Coffee;
  return (
    <li key={c.id}>
      <Link href={c.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
        <span title={copy.kindName[c.kind]} className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
          <Icon aria-label={copy.kindName[c.kind]} className="h-[18px] w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {shortDay(copy, c.date)}
            {c.people.length > 0 && ` · ${c.people.map((p) => p.name).join(", ")}`}
          </span>
          <span className="line-clamp-2 block text-sm text-muted">{c.summary}</span>
        </span>
      </Link>
    </li>
  );
}
