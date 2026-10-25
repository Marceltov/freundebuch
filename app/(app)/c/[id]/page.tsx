import Link from "next/link";
import { ArrowLeftRight, Cake, CalendarDays, Coffee, Lock, MapPin, Pin, Users } from "lucide-react";
import { anchorId, getConversation, today, type ConversationView } from "@/backend";
import { copy, dateKindName, kindName, relationName } from "@/components/copy";
import { Face } from "@/components/Face";
import { dayMonth, shortDay } from "@/components/format";
import { CATEGORY_ICON, EXCHANGE_ICON, KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { Section, Tile } from "@/components/Tiles";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.conversation };

// One conversation: when and how, who was there, the summary, everything filed from it (done and outdated items too, so a link
// to any of them lands on its row), and the verbatim transcript, or a lock when it is private to the other user (it holds
// something only they may read).
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
        <ItemActions table="conversations" id={c.id} mine={c.recordedBy === v.userId} visibility={c.visibility} text={c.summary} field="summary" after="/" date={c.date} today={today()} />
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

      <Recorded c={c} userId={v.userId} />

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

// Everything filed from the conversation that the viewer may see, each row named for whom it is about. Its actions are the ones
// the friend page offers, while the item is open there.
function Recorded({ c, userId }: { c: ConversationView; userId: string }) {
  const { facts, promises, dates, exchanges, relationships } = c;
  if (facts.length + promises.length + dates.length + exchanges.length + relationships.length === 0) return null;
  const priv = (x: { visibility: string }) => x.visibility === "private";
  const actions = (table: "facts" | "promises" | "exchanges", x: { id: string; recordedBy: string; visibility: "shared" | "private"; text: string }) => (
    <ItemActions table={table} id={x.id} mine={x.recordedBy === userId} visibility={x.visibility} text={x.text} />
  );
  return (
    <Section title={copy.recorded}>
      {facts.map((f) => (
        <Tile
          key={f.id}
          id={anchorId("facts", f.id)}
          icon={CATEGORY_ICON[f.category]}
          private={priv(f)}
          closed={f.status === "outdated" ? copy.outdated : undefined}
          actions={f.status === "current" && actions("facts", f)}
        >
          <b>{f.name}: </b>
          {f.text}
        </Tile>
      ))}
      {promises.map((p) => (
        <Tile key={p.id} id={anchorId("promises", p.id)} icon={Pin} private={priv(p)} closed={p.done ? copy.done : undefined} actions={!p.done && actions("promises", p)}>
          <b>{p.byMe ? copy.byMe : (p.by ?? p.name)}: </b>
          {p.text}
          {p.due && <span className="text-muted"> · {shortDay(p.due)}</span>}
        </Tile>
      ))}
      {exchanges.map((e) => (
        <Tile
          key={e.id}
          id={anchorId("exchanges", e.id)}
          icon={EXCHANGE_ICON[e.kind] ?? ArrowLeftRight}
          private={priv(e)}
          closed={e.settled ? copy.done : undefined}
          actions={!e.settled && actions("exchanges", e)}
        >
          <b>{e.name}: </b>
          {e.by && <b>{e.by} </b>}
          {e.kind !== "gift_idea" && <span aria-hidden>{e.direction === "to_them" ? "→ " : "← "}</span>}
          {e.text}
          {e.amount !== null && ` · ${e.amount}${e.currency ? ` ${e.currency}` : ""}`}
        </Tile>
      ))}
      {dates.map((d) => (
        <Tile key={d.id} id={anchorId("dates", d.id)} icon={d.kind === "birthday" ? Cake : CalendarDays} private={priv(d)}>
          <b>{d.name}: </b>
          {d.label ?? dateKindName[d.kind]} · {dayMonth(d.date.replace(/^--/, "2000-"))}
        </Tile>
      ))}
      {relationships.map((r) => (
        <Tile key={r.id} id={anchorId("relationships", r.id)} icon={Users} private={priv(r)}>
          <b>{r.fromName}: </b>
          {r.toName}
          {relationName[r.type]?.out && <span className="text-muted"> · {relationName[r.type].out}</span>}
        </Tile>
      ))}
    </Section>
  );
}
