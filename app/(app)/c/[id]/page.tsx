import Link from "next/link";
import { ArrowLeftRight, Cake, CalendarDays, ChevronRight, Coffee, Lock, MapPin, Mic, NotebookPen, Pin, Users } from "lucide-react";
import type { ReactNode } from "react";
import { anchorId, conversationPath, getConversation, itemPath, personPath, today, type ConversationView } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { Face } from "@/components/Face";
import { dayMonth, longDay, shortDay } from "@/components/format";
import { CATEGORY_ICON, EXCHANGE_ICON, KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { ShareButton } from "@/components/ShareButton";
import { Section, Tile } from "@/components/Tiles";
import { orNotFound, pageViewer, pageCopy } from "../../viewer";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).conversation });

// One conversation: when and how, who was there and who was only mentioned (each by name, linking to them), the summary,
// everything filed from it as sentences (done and outdated items too, so a link to any of them lands on its row; an open item
// also opens on the person's page), and the verbatim transcript, or a lock when it is private to the other user.
export default async function ConversationPage({ params }: PageProps<"/c/[id]">) {
  const v = await pageViewer((await params).id);
  const copy = getCopy();
  const c = await orNotFound(getConversation(v, (await params).id));
  const Icon = KIND_ICON[c.kind] ?? Coffee;
  const there = c.participants.filter((p) => p.id !== v.personId);
  const present = new Set(c.participants.map((p) => p.id));
  const mentioned = new Map<string, string>();
  for (const x of [...c.facts, ...c.promises, ...c.dates, ...c.exchanges]) if (!present.has(x.personId)) mentioned.set(x.personId, x.name);
  for (const r of c.relationships)
    for (const [id, name] of [
      [r.fromId, r.fromName],
      [r.toId, r.toName],
    ])
      if (!present.has(id)) mentioned.set(id, name);
  mentioned.delete(v.personId);
  return (
    <article>
      <header className="flex items-center gap-3">
        <span title={copy.kindName[c.kind]} className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-carbon">
          <Icon aria-label={copy.kindName[c.kind]} className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl leading-tight font-bold">{longDay(copy, c.date)}</h1>
          {c.place && (
            <p className="flex items-center gap-1 text-sm text-muted">
              <MapPin aria-hidden className="h-3.5 w-3.5" />
              {c.place}
            </p>
          )}
        </div>
        {c.visibility === "private" && <Lock aria-label={copy.privateItem} className="h-4 w-4 text-muted" />}
        <ShareButton path={conversationPath(c.id)} title={longDay(copy, c.date)} />
        <ItemActions
          table="conversations"
          id={c.id}
          mine={c.recordedBy === v.userId}
          visibility={c.visibility}
          text={c.summary}
          field="summary"
          after="/"
          date={c.date}
          today={today()}
        />
      </header>

      {(there.length > 0 || mentioned.size > 0) && (
        <div className="mt-5 flex flex-wrap items-start gap-x-4 gap-y-3">
          {there.length > 0 && <People label={copy.participants} people={there} />}
          {there.length > 0 && mentioned.size > 0 && <span aria-hidden className="w-px self-stretch bg-rule" />}
          {mentioned.size > 0 && <People label={copy.mentioned} people={[...mentioned].map(([id, name]) => ({ id, name }))} faded />}
        </div>
      )}

      <p className="mt-5 rounded-2xl bg-surface p-4 text-[15px] leading-relaxed shadow-card">{c.summary}</p>

      <Recorded c={c} userId={v.userId} />

      <Section title={copy.transcript} icon={Mic}>
        {c.transcript === null ? (
          <p className="flex items-center gap-2 text-muted">
            <Lock aria-hidden className="h-4 w-4" />
            {copy.transcriptPrivate}
          </p>
        ) : (
          <p className="text-sm whitespace-pre-wrap text-muted">{c.transcript}</p>
        )}
      </Section>
    </article>
  );
}

// Stickers with names under them; `faded` for people only mentioned.
function People({ label, people, faded }: { label: string; people: { id: string; name: string }[]; faded?: boolean }) {
  const copy = getCopy();
  return (
    <ul aria-label={label} className="flex flex-wrap gap-3">
      {people.map((p) => (
        <li key={p.id}>
          <Link href={personPath(p.id)} className={`flex w-16 flex-col items-center gap-1 text-center text-xs leading-tight ${faded ? "opacity-55" : ""}`}>
            <Face id={p.id} name={p.name} size={44} />
            <span className="line-clamp-2">{p.name}</span>
            {faded && <span className="sr-only">, {copy.mentioned}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const Name = ({ id, name }: { id: string; name: string }) => (
  <Link href={personPath(id)} className="font-bold underline decoration-carbon/40 decoration-2 underline-offset-3 hover:decoration-carbon">
    {name}
  </Link>
);

// A sentence from copy with its {name} (or {a} and {b}) replaced by links.
function sentence(template: string, parts: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((bit, i) => {
    const key = bit.match(/^\{(\w+)\}$/)?.[1];
    return <span key={i}>{key && key in parts ? parts[key] : bit}</span>;
  });
}

// The › that opens an open item on its person's page. A plain link, not next/link: a client-side navigation doesn't set the
// browser's :target, so the row wouldn't be highlighted.
const OpenAt = ({ personId, name, table, id }: { personId: string; name: string; table: "facts" | "promises" | "dates" | "exchanges"; id: string }) => {
  const copy = getCopy();
  return (
    <a
      href={itemPath(personPath(personId), table, id)}
      aria-label={copy.openAt.replace("{name}", name)}
      title={copy.openAt.replace("{name}", name)}
      className="-mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-carbon hover:bg-surface-2"
    >
      <ChevronRight aria-hidden className="h-5 w-5" />
    </a>
  );
};

// Everything filed from the conversation that the viewer may see, each as a sentence naming whom it is about. Open items carry
// the friend page's actions and a › to the person's page; done and outdated ones are muted and say so.
function Recorded({ c, userId }: { c: ConversationView; userId: string }) {
  const copy = getCopy();
  const { facts, promises, dates, exchanges, relationships } = c;
  if (facts.length + promises.length + dates.length + exchanges.length + relationships.length === 0) return null;
  const priv = (x: { visibility: string }) => x.visibility === "private";
  const actions = (table: "facts" | "promises" | "exchanges", x: { id: string; recordedBy: string; visibility: "shared" | "private"; text: string }) => (
    <ItemActions table={table} id={x.id} mine={x.recordedBy === userId} visibility={x.visibility} text={x.text} />
  );
  return (
    <Section title={copy.recorded} icon={NotebookPen}>
      {facts.map((f) => {
        const open = f.status === "current";
        return (
          <Tile
            key={f.id}
            id={anchorId("facts", f.id)}
            icon={CATEGORY_ICON[f.category]}
            private={priv(f)}
            closed={open ? undefined : copy.outdated}
            actions={
              open && (
                <>
                  {actions("facts", f)}
                  <OpenAt personId={f.personId} name={f.name} table="facts" id={f.id} />
                </>
              )
            }
          >
            <Name id={f.personId} name={f.name} />: {f.text}
          </Tile>
        );
      })}
      {promises.map((p) => {
        const who = <Name id={p.personId} name={p.name} />;
        const lead = p.byMe
          ? sentence(copy.youPromised, { name: who })
          : p.by
            ? sentence(copy.partnerPromised, { by: p.by, name: who })
            : sentence(copy.theyPromised, { name: who });
        return (
          <Tile
            key={p.id}
            id={anchorId("promises", p.id)}
            icon={Pin}
            private={priv(p)}
            closed={p.done ? copy.done : undefined}
            actions={
              !p.done && (
                <>
                  {actions("promises", p)}
                  <OpenAt personId={p.personId} name={p.name} table="promises" id={p.id} />
                </>
              )
            }
          >
            {lead} {p.text}
            {p.due && <span className="text-muted"> · {shortDay(copy, p.due)}</span>}
          </Tile>
        );
      })}
      {exchanges.map((e) => (
        <Tile
          key={e.id}
          id={anchorId("exchanges", e.id)}
          icon={EXCHANGE_ICON[e.kind] ?? ArrowLeftRight}
          private={priv(e)}
          closed={e.settled ? copy.done : undefined}
          actions={
            !e.settled && (
              <>
                {actions("exchanges", e)}
                <OpenAt personId={e.personId} name={e.name} table="exchanges" id={e.id} />
              </>
            )
          }
        >
          <Name id={e.personId} name={e.name} />: {e.by && <b>{e.by} </b>}
          {e.kind !== "gift_idea" && <span aria-hidden>{e.direction === "to_them" ? "→ " : "← "}</span>}
          {e.text}
          {e.amount !== null && ` · ${e.amount}${e.currency ? ` ${e.currency}` : ""}`}
        </Tile>
      ))}
      {dates.map((d) => (
        <Tile
          key={d.id}
          id={anchorId("dates", d.id)}
          icon={d.kind === "birthday" ? Cake : CalendarDays}
          private={priv(d)}
          actions={<OpenAt personId={d.personId} name={d.name} table="dates" id={d.id} />}
        >
          <Name id={d.personId} name={d.name} />: {d.label ?? copy.dateKindName[d.kind]} · {dayMonth(copy, d.date.replace(/^--/, "2000-"))}
        </Tile>
      ))}
      {relationships.map((r) => (
        <Tile key={r.id} id={anchorId("relationships", r.id)} icon={Users} private={priv(r)}>
          {sentence(copy.relationSentence, { a: <Name id={r.fromId} name={r.fromName} />, label: r.label, b: <Name id={r.toId} name={r.toName} /> })}
        </Tile>
      ))}
    </Section>
  );
}
