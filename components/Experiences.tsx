import Link from "next/link";
import { CalendarCheck, CalendarX, Lock, MapPin, Mic, Repeat } from "lucide-react";
import type { ExperienceView } from "@/backend";
import { copy } from "@/components/copy";
import { shortDay } from "@/components/format";
import { ItemActions } from "@/components/ItemActions";

const chip = "inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs hover:bg-rule";

// One experience: its day, kind and title, a few lines, and links to its place, its series, the people who were there and the
// ramble it was told in; a lock while private, and its actions for whoever recorded it. `series`: false on its own series' page.
export function ExperienceItem({ e, series = true }: { e: ExperienceView; series?: boolean }) {
  return (
    <li id={`experience-${e.id}`} className="rounded-2xl bg-surface p-3 shadow-card target:ring-2 target:ring-carbon">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 text-sm">
          <p>
            <b>{shortDay(e.date)}</b> · <span className="text-muted">{e.kind}</span>{" "}
            {e.visibility === "private" && <Lock aria-label={copy.journalPrivate} className="mb-0.5 inline h-3.5 w-3.5 text-muted" />}
          </p>
          <p className="font-semibold">{e.title}</p>
          {e.summary && <p className="mt-0.5 whitespace-pre-line text-muted">{e.summary}</p>}
        </div>
        {e.mine && <ItemActions table="experiences" id={e.id} mine visibility={e.visibility} text={e.title} field="title" />}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.place && (
          <Link href={e.place.url} className={chip}>
            <MapPin aria-hidden className="h-3 w-3" />
            {e.place.name}
          </Link>
        )}
        {series && e.series && (
          <Link href={e.series.url} className={chip}>
            <Repeat aria-hidden className="h-3 w-3" />
            {e.series.name}
          </Link>
        )}
        {e.people.map((p) => (
          <Link key={p.id} href={p.url} className={`${chip} font-semibold text-carbon`}>
            {p.name}
          </Link>
        ))}
        <Link href={`/r/${e.rambleId}`} className={chip}>
          <Mic aria-hidden className="h-3 w-3" />
          {copy.ramble}
        </Link>
      </div>
    </li>
  );
}

// A series' days that weren't sessions: the latest missing one (not told yet) and those marked skipped.
export function SeriesDays({ missed, skipped }: { missed: string[]; skipped: string[] }) {
  if (!missed.length && !skipped.length) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {missed.map((d) => (
        <li key={`m-${d}`} className="flex items-center gap-1.5 text-carbon">
          <CalendarX aria-hidden className="h-4 w-4" />
          {copy.sessionMissed.replace("{day}", shortDay(d))}
        </li>
      ))}
      {skipped.map((d) => (
        <li key={`s-${d}`} className="flex items-center gap-1.5 text-muted">
          <CalendarCheck aria-hidden className="h-4 w-4" />
          {copy.sessionSkipped.replace("{day}", shortDay(d))}
        </li>
      ))}
    </ul>
  );
}
