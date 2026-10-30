import Link from "next/link";
import { MapPin, MessagesSquare, Repeat, Ticket } from "lucide-react";
import { getPlace } from "@/backend";
import { copy } from "@/components/copy";
import { shortDay } from "@/components/format";
import { ExperienceItem } from "@/components/Experiences";
import { PlaceFacts } from "@/components/Place";
import { Section } from "@/components/Tiles";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.place };

// A place: its other names, where it sits, its address and whose home it is, the places inside it, and everything at it or inside
// it the viewer may see: series, experiences and conversations, newest first.
export default async function PlacePage({ params }: PageProps<"/o/[id]">) {
  const v = await pageViewer();
  const p = await orNotFound(getPlace(v, (await params).id));
  return (
    <div>
      <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
        <MapPin aria-hidden className="h-7 w-7 text-carbon" />
        {p.name}
      </h1>
      {p.aliases.length > 0 && <p className="mt-1 text-muted">{copy.placeOther.replace("{names}", p.aliases.join(", "))}</p>}
      <PlaceFacts p={p} />
      {p.series.length > 0 && (
        <Section title={copy.placeSeries} icon={Repeat} list>
          {p.series.map((s) => (
            <li key={s.id} className="py-1">
              <Link href={s.url} className="font-semibold text-carbon">
                {s.name}
              </Link>
            </li>
          ))}
        </Section>
      )}
      {p.experiences.length > 0 && (
        <Section title={copy.experiences} icon={Ticket} plain>
          <ul className="space-y-2">
            {p.experiences.map((e) => (
              <ExperienceItem key={e.id} e={e} />
            ))}
          </ul>
        </Section>
      )}
      {p.conversations.length > 0 && (
        <Section title={copy.conversations} icon={MessagesSquare} list>
          {p.conversations.map((c) => (
            <li key={c.id} className="py-1 text-sm">
              <Link href={c.url}>
                <b>{shortDay(c.date)}</b> {c.summary}
              </Link>
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}
