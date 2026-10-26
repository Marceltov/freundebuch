import Link from "next/link";
import { ArrowLeftRight, Cake, CalendarDays, Coffee, Gift, Handshake, Lock, MessagesSquare, Mic, Pin, Repeat, Sparkles, Users } from "lucide-react";
import { anchorId, type Briefing } from "@/backend";
import { copy, kindName, relationName } from "@/components/copy";
import { Face } from "@/components/Face";
import { ago, dayMonth, every, shortDay } from "@/components/format";
import { GroupPicker } from "@/components/GroupPicker";
import { CATEGORY_ICON, EXCHANGE_ICON, KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { PersonMenu } from "@/components/PersonMenu";
import { Chip, Section, Tile, groupTint } from "@/components/Tiles";

// One friend, as a page of the friendship book: the sticker and the name, the chips (last seen, birthday, interval, dates,
// groups), then the fields filled in: what's going on, what was promised, gift ideas, what's still open, the conversations and
// who they belong with. Fields without content are left out. `daysSince`: since the viewer last saw them, null for never.
// `allGroups`: every group the viewer sees, for "+ Gruppe". `others`: everyone else, for merging a duplicate in the menu.
// `today` (YYYY-MM-DD, the server's) turns the age reached on the next birthday into the age the person is now; the birthday
// chip shows the year of birth when it is known.
export function FriendPage({
  b,
  daysSince,
  allGroups = [],
  others = [],
  today,
}: {
  b: Briefing;
  daysSince: number | null;
  allGroups?: { id: string; name: string }[];
  others?: { id: string; name: string }[];
  today?: string;
}) {
  const birthday = b.person.birthday;
  const otherDates = b.nextDates.filter((d) => d.kind !== "birthday");
  const { promises, exchanges, giftIdeas } = b.open;
  return (
    <article>
      <header>
        <div className="flex items-center gap-4">
          <Face id={b.person.id} name={b.person.name} size={80} ratio={b.freshness.ratio} />
          <h1 className="min-w-0 font-display text-3xl leading-tight font-bold">{b.person.name}</h1>
          <PersonMenu id={b.person.id} name={b.person.name} intervalDays={b.freshness.intervalDays} others={others} />
        </div>
        <div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip icon={Coffee} label={copy.lastSeen}>
              {daysSince === null ? copy.neverSeen : ago(daysSince)}
            </Chip>
            {birthday && (
              <Chip id={anchorId("dates", birthday.id)} icon={Cake} tone="bg-sun font-bold text-on-sun">
                {dayMonth(birthday.next)}
                {/^\d{4}-/.test(birthday.date) && ` ${birthday.date.slice(0, 4)}`}
                {birthday.age !== null && ` · ${copy.ageYears.replace("{n}", String(birthday.next === today ? birthday.age : birthday.age - 1))}`}
              </Chip>
            )}
            {b.freshness.intervalDays !== null && (
              <Chip icon={Repeat} label={copy.interval}>
                {every(b.freshness.intervalDays)}
              </Chip>
            )}
            {otherDates.map((d) => (
              <Chip key={d.id} id={anchorId("dates", d.id)} icon={CalendarDays}>
                {dayMonth(d.date)}
                {d.label && ` · ${d.label}`}
              </Chip>
            ))}
            {b.groups.map((g) => (
              <Chip key={g.id} href={g.url} icon={Users} label={copy.group} tone={groupTint(g.id)}>
                {g.name}
                {g.private && (
                  <span title={copy.privateItem} className="inline-flex">
                    <Lock aria-label={copy.privateItem} className="h-3 w-3" />
                  </span>
                )}
              </Chip>
            ))}
            <GroupPicker personId={b.person.id} personName={b.person.name} groups={allGroups} member={b.groups.map((g) => g.id)} />
          </div>
        </div>
      </header>

      {b.situations.length + b.known.length > 0 && (
        <Section title={copy.now} icon={Sparkles}>
          {[...b.situations, ...b.known].map((f) => (
            <Tile key={f.id} id={anchorId("facts", f.id)} icon={CATEGORY_ICON[f.category]} private={f.visibility === "private"} actions={<ItemActions table="facts" {...item(f)} />}>
              {f.text}
              {(f.source || f.happenedOn) && <span className="text-muted"> · {[f.source, f.happenedOn && dayMonth(f.happenedOn)].filter(Boolean).join(", ")}</span>}
              {f.imageUrl && (
                <a href={f.imageUrl} target="_blank" rel="noreferrer" className="ml-2 inline-block align-middle" title={copy.screenshotOf.replace("{source}", f.source ?? "")}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind the sign-in, not for next/image */}
                  <img src={f.imageUrl} alt={copy.screenshot} loading="lazy" className="h-9 w-9 rounded-md bg-surface-2 object-cover object-top" />
                </a>
              )}
            </Tile>
          ))}
        </Section>
      )}

      {promises.length > 0 && (
        <Section title={copy.promised} icon={Handshake}>
          {promises.map((p) => (
            <Tile key={p.id} id={anchorId("promises", p.id)} icon={Pin} private={p.visibility === "private"} actions={<ItemActions table="promises" {...item(p)} />}>
              {(p.byMe || p.by) && <b>{p.byMe ? copy.byMe : p.by}: </b>}
              {p.text}
              {p.due && <span className="text-muted"> · {shortDay(p.due)}</span>}
            </Tile>
          ))}
        </Section>
      )}

      {giftIdeas.length > 0 && (
        <Section title={copy.giftIdeas} icon={Gift}>
          {giftIdeas.map((g) => (
            <Tile key={g.id} id={anchorId("exchanges", g.id)} icon={Gift} private={g.visibility === "private"} actions={<ItemActions table="exchanges" {...item(g)} />}>
              {g.text}
            </Tile>
          ))}
        </Section>
      )}

      {exchanges.length > 0 && (
        <Section title={copy.stillOpen} icon={ArrowLeftRight}>
          {exchanges.map((e) => (
            <Tile key={e.id} id={anchorId("exchanges", e.id)} icon={EXCHANGE_ICON[e.kind] ?? ArrowLeftRight} private={e.visibility === "private"} actions={<ItemActions table="exchanges" {...item(e)} />}>
              {e.by && <b>{e.by} </b>}
              <span aria-hidden>{e.direction === "to_them" ? "→ " : "← "}</span>
              {e.text}
              {e.amount !== null && ` · ${e.amount}${e.currency ? ` ${e.currency}` : ""}`}
            </Tile>
          ))}
        </Section>
      )}

      {b.recent.length > 0 && (
        <Section title={copy.conversations} icon={MessagesSquare} list>
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
        <Section title={copy.theirPeople} icon={Users} plain>
          <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
            {b.relationships.map((r) => {
              const what = [relationName[r.type]?.[r.direction], r.note].filter(Boolean).join(" · ");
              return (
                <li key={r.id} id={anchorId("relationships", r.id)} className="flex items-center rounded-2xl bg-surface pr-1 shadow-card">
                  <Link href={r.url} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-surface-2/60">
                    <Face id={r.personId} name={r.name} size={38} />
                    <span className="min-w-0">
                      <span className="block truncate font-display text-lg leading-tight font-semibold">
                        {r.name}
                        {r.visibility === "private" && <Lock aria-label={copy.privateItem} className="ml-1.5 inline h-3.5 w-3.5 text-muted" />}
                      </span>
                      {what && <span className="block truncate text-sm text-muted">{what}</span>}
                    </span>
                  </Link>
                  <ItemActions table="relationships" field="note" id={r.id} mine={r.mine} visibility={r.visibility} text={r.note ?? ""} />
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </article>
  );
}

// What ItemActions needs of an item, and no more: it is a client component, so its props travel to the browser.
const item = (x: { id: string; mine: boolean; visibility: "shared" | "private"; text: string }) => ({ id: x.id, mine: x.mine, visibility: x.visibility, text: x.text });
