import Link from "next/link";
import { Coffee, Lock, Mic, NotebookPen } from "lucide-react";
import { getRamble } from "@/backend";
import { copy, kindName } from "@/components/copy";
import { shortDay } from "@/components/format";
import { KIND_ICON } from "@/components/icons";
import { JournalItem } from "@/components/Journal";
import { Section } from "@/components/Tiles";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.ramble };

// A ramble: what was told in one go, the conversations and journal entries filed from it that the viewer may see, and the
// verbatim transcript, or a lock when it is private to the other user.
export default async function RamblePage({ params }: PageProps<"/r/[id]">) {
  const v = await pageViewer();
  const r = await orNotFound(getRamble(v, (await params).id));
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.ramble}</h1>
      <p className="mt-1 text-muted">{shortDay(r.date)}</p>
      {r.conversations.length > 0 && (
        <Section title={copy.conversations} icon={Coffee} list>
          {r.conversations.map((c) => {
            const Icon = KIND_ICON[c.kind] ?? Coffee;
            return (
              <li key={c.id} className="py-1">
                <Link href={c.url} className="flex gap-3 rounded-2xl bg-surface p-3 shadow-card hover:bg-surface-2/50">
                  <Icon aria-label={kindName[c.kind]} className="mt-0.5 h-[18px] w-[18px] shrink-0 text-carbon" />
                  <span className="min-w-0 text-sm">
                    <b>{shortDay(c.date)}</b>
                    {c.people.length > 0 && ` · ${c.people.map((p) => p.name).join(", ")}`} {c.summary}
                  </span>
                </Link>
              </li>
            );
          })}
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
    </div>
  );
}
