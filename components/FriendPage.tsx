import Link from "next/link";
import { ArrowLeftRight, Cake, CalendarDays, Coffee, Gift, Lock, Mic, Pin, Repeat, Users, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Briefing } from "@/backend";
import { copy, kindName } from "@/components/copy";
import { Face } from "@/components/Face";
import { ago, dayMonth, every, shortDay } from "@/components/format";
import { CATEGORY_ICON, EXCHANGE_ICON, KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { MiniGraph } from "@/components/MiniGraph";

// One friend, as the approved mockup: who (face, freshness ring, chips), what's going on now (tiles), what's open, what happened
// (the timeline, each entry linking to its conversation), and who they're connected to. Sections without content are left out.
// `daysSince`: since the viewer last saw them, null for never.
export function FriendPage({ b, daysSince }: { b: Briefing; daysSince: number | null }) {
  const birthday = b.person.birthday;
  const otherDates = b.nextDates.filter((d) => d.kind !== "birthday");
  const { promises, exchanges, giftIdeas } = b.open;
  return (
    <article>
      <header className="flex items-center gap-4">
        <Face id={b.person.id} name={b.person.name} size={64} ratio={b.freshness.ratio} />
        <div className="min-w-0">
          <h1 className="text-xl leading-tight font-bold">{b.person.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1">
            <Chip icon={Coffee} label={copy.lastSeen}>
              {daysSince === null ? copy.neverSeen : ago(daysSince)}
            </Chip>
            {birthday && (
              <Chip icon={Cake}>
                {dayMonth(birthday.next)}
                {birthday.age !== null && ` · ${birthday.age}`}
              </Chip>
            )}
            {b.freshness.intervalDays !== null && (
              <Chip icon={Repeat} label={copy.interval}>
                {every(b.freshness.intervalDays)}
              </Chip>
            )}
            {otherDates.map((d) => (
              <Chip key={d.id} icon={CalendarDays}>
                {dayMonth(d.date)}
                {d.label && ` · ${d.label}`}
              </Chip>
            ))}
            {b.groups.map((g) => (
              <Chip key={g} icon={Users} label={copy.group}>
                {g}
              </Chip>
            ))}
          </div>
        </div>
      </header>

      {b.current.length > 0 && (
        <Section title={copy.now}>
          {b.current.map((f) => (
            <Tile key={f.id} icon={CATEGORY_ICON[f.category]} private={f.visibility === "private"} actions={<ItemActions table="facts" {...item(f)} />}>
              {f.text}
            </Tile>
          ))}
        </Section>
      )}

      {promises.length + exchanges.length + giftIdeas.length > 0 && (
        <Section title={copy.open}>
          {promises.map((p) => (
            <Tile key={p.id} icon={Pin} private={p.visibility === "private"} actions={<ItemActions table="promises" {...item(p)} />}>
              {p.byMe && <b>{copy.byMe}: </b>}
              {p.text}
              {p.due && <span className="text-muted"> · {shortDay(p.due)}</span>}
            </Tile>
          ))}
          {giftIdeas.map((g) => (
            <Tile key={g.id} icon={Gift} private={g.visibility === "private"} actions={<ItemActions table="exchanges" {...item(g)} />}>
              {g.text}
            </Tile>
          ))}
          {exchanges.map((e) => (
            <Tile key={e.id} icon={EXCHANGE_ICON[e.kind] ?? ArrowLeftRight} private={e.visibility === "private"} actions={<ItemActions table="exchanges" {...item(e)} />}>
              <span aria-hidden>{e.direction === "to_them" ? "→ " : "← "}</span>
              {e.text}
              {e.amount !== null && ` · ${e.amount}${e.currency ? ` ${e.currency}` : ""}`}
            </Tile>
          ))}
        </Section>
      )}

      {b.recent.length > 0 && (
        <Section title={copy.timeline} list>
          {b.recent.map((c) => {
            const Icon = KIND_ICON[c.kind] ?? Coffee;
            return (
              <li key={c.id} className="flex items-start gap-3 py-1.5">
                <span title={kindName[c.kind]} className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon aria-label={kindName[c.kind]} className="h-4 w-4" />
                </span>
                <div className="min-w-0 text-sm">
                  <b>{shortDay(c.date)}</b> {c.summary}
                  {c.withOthers.length > 0 && <span className="text-muted"> · {copy.withOthers.replace("{names}", c.withOthers.join(", "))}</span>}{" "}
                  <Link href={`/c/${c.id}`} className="ml-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs whitespace-nowrap hover:bg-rule/60">
                    <Mic aria-hidden className="h-3 w-3" />
                    {copy.transcript}
                  </Link>
                </div>
              </li>
            );
          })}
        </Section>
      )}

      {b.relationships.length > 0 && (
        <Section title={copy.theirPeople} plain>
          <MiniGraph person={b.person} relationships={b.relationships} />
        </Section>
      )}
    </article>
  );
}

// What ItemActions needs of an item, and no more: it is a client component, so its props travel to the browser.
const item = (x: { id: string; mine: boolean; visibility: "shared" | "private"; text: string }) => ({ id: x.id, mine: x.mine, visibility: x.visibility, text: x.text });

function Chip({ icon: Icon, label, children }: { icon: LucideIcon; label?: string; children: ReactNode }) {
  return (
    <span title={label} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label && <span className="sr-only">{label}: </span>}
      {children}
    </span>
  );
}

// `list`: the children are <li>; `plain`: one block, no grid.
function Section({ title, list, plain, children }: { title: string; list?: boolean; plain?: boolean; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">{title}</h2>
      {list ? <ul>{children}</ul> : plain ? children : <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">{children}</div>}
    </section>
  );
}

// An icon tile: the item's icon (a lock instead for a private one), its text, and its actions.
function Tile({ icon: Icon, private: priv, actions, children }: { icon: LucideIcon; private: boolean; actions: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm shadow-card">
      <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 opacity-75" />
      <span className="min-w-0 flex-1">
        {children}
        {priv && (
          <span title={copy.privateItem} className="ml-1 inline-flex align-[-2px] text-muted">
            <Lock aria-label={copy.privateItem} className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      {actions}
    </div>
  );
}
