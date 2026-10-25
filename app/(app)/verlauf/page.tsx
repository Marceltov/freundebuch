import Link from "next/link";
import { Coffee } from "lucide-react";
import { listConversations, today } from "@/backend";
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
const monthYear = (day: string) => new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

// Every conversation the viewer may see, newest first: this week, last week, then by month. Each links to its page, where what
// Claude filed can be checked and fixed.
export default async function HistoryPage() {
  const v = await pageViewer();
  const now = today();
  const conversations = await listConversations(v);
  const thisWeek = mondayOf(now);
  const heading = (day: string) => {
    const weeks = (thisWeek - mondayOf(day)) / 7;
    return weeks <= 0 ? copy.thisWeek : weeks === 1 ? copy.lastWeek : monthYear(day);
  };
  const groups = new Map<string, typeof conversations>();
  for (const c of conversations) groups.set(heading(c.date), [...(groups.get(heading(c.date)) ?? []), c]);
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.tabHistory}</h1>
      {conversations.length === 0 && <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.nothingFiled}</p>}
      {[...groups].map(([title, cs]) => (
        <section key={title} className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold">{title}</h2>
          <ul className="space-y-2">
            {cs.map((c) => {
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
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
