import Link from "next/link";
import { MapPin, Repeat } from "lucide-react";
import { getSeries } from "@/backend";
import { copy } from "@/components/copy";
import { shortDay } from "@/components/format";
import { ExperienceItem, SeriesDays } from "@/components/Experiences";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.sessions };

// A series (a course, a weekly training): its rhythm, its place, its sessions by date, and the days that weren't sessions: the
// latest one that passed untold, and those marked skipped.
export default async function SeriesPage({ params }: PageProps<"/s/[id]">) {
  const v = await pageViewer();
  const s = await orNotFound(getSeries(v, (await params).id));
  const rhythm = s.rhythmDays === 7 ? copy.everyWeek : s.rhythmDays ? copy.everyDays.replace("{n}", String(s.rhythmDays)) : null;
  return (
    <div>
      <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
        <Repeat aria-hidden className="h-7 w-7 text-carbon" />
        {s.name}
      </h1>
      <p className="mt-1 text-muted">
        {[s.kind, rhythm, s.startsOn && `${shortDay(s.startsOn)}${s.endsOn ? ` ${copy.seriesEnded.replace("{day}", shortDay(s.endsOn))}` : ""}`].filter(Boolean).join(" · ")}
      </p>
      {s.place && (
        <Link href={s.place.url} className="mt-2 inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-rule">
          <MapPin aria-hidden className="h-4 w-4" />
          {s.place.name}
        </Link>
      )}
      <SeriesDays missed={s.missed} skipped={s.skipped} />
      <ul className="mt-4 space-y-2">
        {s.sessions.map((e) => (
          <ExperienceItem key={e.id} e={e} series={false} />
        ))}
      </ul>
    </div>
  );
}
