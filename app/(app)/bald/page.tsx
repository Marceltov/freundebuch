import Link from "next/link";
import { Cake, CalendarDays, HandHeart, Handshake } from "lucide-react";
import { daysBetween, today, whatsDue } from "@/backend";
import { copy, dateKindName } from "@/components/copy";
import { DoneButton } from "@/components/DoneButton";
import { Face } from "@/components/Face";
import { Nudges } from "@/components/Nudges";
import { ago, every, longDay, shortDay } from "@/components/format";
import { Section } from "@/components/Tiles";
import { pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.tabSoon };

const inDays = (n: number) => (n === 0 ? copy.today : n === 1 ? copy.tomorrow : copy.inDays.replace("{n}", String(n)));

// The next two weeks: birthdays and other dates, the viewer's own promises with a due day (ticked off right here), and who
// would be glad to hear from them, and the situations to ask about, as the reminder sends it.
export default async function SoonPage() {
  const v = await pageViewer();
  const now = today();
  const items = await whatsDue(v);
  const dates = items.filter((i) => i.kind === "date");
  const promises = items.filter((i) => i.kind === "promise");
  const overdue = items.filter((i) => i.kind === "overdue");
  const situations = items.filter((i) => i.kind === "situation");
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.tabSoon}</h1>
      <p className="text-muted">{copy.nextTwoWeeks}</p>

      {items.length === 0 && <p className="mt-6 rounded-2xl bg-surface p-4 shadow-card">{copy.nothingSoon}</p>}

      {dates.length > 0 && (
        <Section title={copy.datesSoon} icon={CalendarDays} plain>
          <ul className="space-y-2">
            {dates.map((d) => {
              const birthday = d.text === "birthday";
              return (
                <li key={d.url}>
                  <Link href={d.url} className={`flex items-center gap-3 rounded-2xl p-3 shadow-card ${birthday ? "bg-sun text-on-sun" : "bg-surface"}`}>
                    <Face id={d.personId} name={d.name} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg leading-tight font-bold">
                        {birthday && <Cake aria-hidden className="mr-1 inline h-4 w-4 align-[-2px]" />}
                        {d.name}: {birthday ? dateKindName.birthday : d.text}
                      </span>
                      <span className="block text-sm">
                        {longDay(d.date!)} · {inDays(daysBetween(now, d.date!))}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {promises.length > 0 && (
        <Section title={copy.youPromisedSoon} icon={Handshake} plain>
          <ul className="space-y-2">
            {promises.map((p) => (
              <li key={p.url} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
                <DoneButton id={p.itemId!} text={p.text!} />
                <span className="min-w-0 flex-1">
                  <span className="block">{p.text}</span>
                  <span className="block text-sm text-muted">
                    <Link href={p.url} className="underline decoration-carbon/40 underline-offset-2">
                      {p.name}
                    </Link>{" "}
                    · {copy.until.replace("{day}", shortDay(p.date!))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overdue.length > 0 && (
        <Section title={copy.wouldBeGlad} icon={HandHeart} plain>
          <ul className="space-y-2">
            {overdue.map((o) => (
              <li key={o.url}>
                <Link href={o.url} className="flex items-center gap-3 rounded-2xl bg-surface p-3 shadow-card">
                  <Face id={o.personId} name={o.name} size={40} ratio={o.ratio} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg leading-tight font-semibold">{o.name}</span>
                    <span className="block text-sm text-muted">
                      {copy.sinceWanted.replace("{since}", o.lastSeen ? ago(daysBetween(o.lastSeen, now)) : copy.neverMet).replace("{every}", o.intervalDays ? every(o.intervalDays) : "")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Nudges items={situations} />
    </div>
  );
}
