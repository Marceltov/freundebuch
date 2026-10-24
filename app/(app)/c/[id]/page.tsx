import Link from "next/link";
import { Coffee, Lock, MapPin } from "lucide-react";
import { getConversation } from "@/backend";
import { copy, kindName } from "@/components/copy";
import { Face } from "@/components/Face";
import { shortDay } from "@/components/format";
import { KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.conversation };

// One conversation: when and how, who was there, the summary and the verbatim transcript, or a lock when it is private to the
// other user (it holds something only they may read).
export default async function ConversationPage({ params }: PageProps<"/c/[id]">) {
  const v = await pageViewer();
  const c = await orNotFound(getConversation(v, (await params).id));
  const Icon = KIND_ICON[c.kind] ?? Coffee;
  const others = c.participants.filter((p) => p.id !== v.personId);
  return (
    <article>
      <header className="flex items-center gap-3">
        <span title={kindName[c.kind]} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2">
          <Icon aria-label={kindName[c.kind]} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl leading-tight font-bold">{shortDay(c.date)}</h1>
          {c.place && (
            <p className="flex items-center gap-1 text-sm text-muted">
              <MapPin aria-hidden className="h-3.5 w-3.5" />
              {c.place}
            </p>
          )}
        </div>
        {c.visibility === "private" && <Lock aria-label={copy.privateItem} className="h-4 w-4 text-muted" />}
        <ItemActions table="conversations" id={c.id} mine={c.recordedBy === v.userId} visibility={c.visibility} text={c.summary} field="summary" after="/" />
      </header>

      {others.length > 0 && (
        <ul aria-label={copy.participants} className="mt-4 flex flex-wrap gap-2">
          {others.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.id}`}>
                <Face id={p.id} name={p.name} size={36} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 rounded-xl bg-surface p-4 shadow-card">{c.summary}</p>

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">{copy.transcript}</h2>
        {c.transcript === null ? (
          <p className="flex items-center gap-2 text-muted">
            <Lock aria-hidden className="h-4 w-4" />
            {copy.transcriptPrivate}
          </p>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{c.transcript}</p>
        )}
      </section>
    </article>
  );
}
