import Link from "next/link";
import { BookOpen, Coffee, Lock, Mic, NotebookPen, Ticket } from "lucide-react";
import { chatEnabled, getRamble } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { shortDay } from "@/components/format";
import { KIND_ICON } from "@/components/icons";
import { ExperienceItem } from "@/components/Experiences";
import { JournalItem } from "@/components/Journal";
import { RambleDelete } from "@/components/RambleDelete";
import { Section } from "@/components/Tiles";
import { TellMore } from "@/components/TellMore";
import { orNotFound, pageViewer, pageCopy } from "../../viewer";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).ramble });

// A ramble: what was told in one go, the conversations and journal entries filed from it that the viewer may see, and the
// verbatim transcript, or a lock when it is private to the other user.
export default async function RamblePage({ params }: PageProps<"/r/[id]">) {
  const v = await pageViewer((await params).id);
  const copy = getCopy();
  const r = await orNotFound(getRamble(v, (await params).id));
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.ramble}</h1>
      <p className="mt-1 text-muted">{shortDay(copy, r.date)}</p>
      {/* Add to it or correct it, with Claude: Erzählen opens on this ramble. */}
      {chatEnabled() && (
        <div className="mt-3">
          <TellMore />
        </div>
      )}
      {r.conversations.length > 0 && (
        <Section title={copy.conversations} icon={Coffee} list>
          {r.conversations.map((c) => {
            const Icon = KIND_ICON[c.kind] ?? Coffee;
            return (
              <li key={c.id} className="py-1">
                <Link href={c.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                  <Icon aria-label={copy.kindName[c.kind]} className="mt-0.5 h-[18px] w-[18px] shrink-0 text-carbon" />
                  <span className="min-w-0 text-sm">
                    <b>{shortDay(copy, c.date)}</b>
                    {c.people.length > 0 && ` · ${c.people.map((p) => p.name).join(", ")}`} {c.summary}
                  </span>
                </Link>
              </li>
            );
          })}
        </Section>
      )}
      {r.experiences.length > 0 && (
        <Section title={copy.experiences} icon={Ticket} plain>
          <ul className="space-y-2">
            {r.experiences.map((e) => (
              <ExperienceItem key={e.id} e={e} />
            ))}
          </ul>
        </Section>
      )}
      {r.journal.length > 0 && (
        <Section title={copy.journal} icon={NotebookPen} plain>
          <ul className="space-y-2">
            {r.journal.map((e) => (
              <JournalItem key={e.id} e={e} ramble={false} />
            ))}
          </ul>
        </Section>
      )}
      {r.items.length > 0 && (
        <Section title={copy.rambleItems} icon={BookOpen} list>
          {r.items.map((x) => (
            <li key={x.id} className="py-1 text-sm">
              <Link href={x.person.url} className="font-semibold text-carbon">
                {x.person.name}
              </Link>
              : {x.text}
            </li>
          ))}
        </Section>
      )}
      <Section title={copy.transcript} icon={Mic}>
        {r.transcript === null ? (
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Lock aria-hidden className="h-4 w-4" />
            {copy.transcriptPrivate}
          </p>
        ) : (
          <p className="text-sm whitespace-pre-wrap text-muted">{r.transcript}</p>
        )}
      </Section>
      {r.recordedBy === v.userId && <RambleDelete id={r.id} />}
    </div>
  );
}
