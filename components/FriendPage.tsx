import Link from "next/link";
import {
  ArrowLeftRight,
  BookOpen,
  Cake,
  CalendarDays,
  Coffee,
  Gift,
  Handshake,
  Lock,
  MessageCircleQuestionMark,
  MessagesSquare,
  Mic,
  Pin,
  Repeat,
  Sparkles,
  Users,
} from "lucide-react";
import { anchorId, type Briefing } from "@/backend";
import { copy, kindName, relationLabel, roleLine } from "@/components/copy";
import { Face } from "@/components/Face";
import { ago, dayMonth, every, shortDay } from "@/components/format";
import { GroupPicker } from "@/components/GroupPicker";
import { CATEGORY_ICON, EXCHANGE_ICON, KIND_ICON } from "@/components/icons";
import { ItemActions } from "@/components/ItemActions";
import { layoutNetwork, Network } from "@/components/Network";
import { PersonMenu } from "@/components/PersonMenu";
import { Chip, Section, Tile, groupTint } from "@/components/Tiles";

// One friend, as a page of the friendship book: the sticker, the name and who they are to us, the chips (last seen, birthday, interval, dates,
// groups), then the fields filled in: what's going on (a situation to ask about first), what stays true, what was promised, gift ideas, what's still open, the conversations and
// who they belong with. Fields without content are left out. `daysSince`: since the viewer last saw them, null for never.
// `allGroups`: every group the viewer sees, for "+ Gruppe". `others`: everyone else, for merging a duplicate in the menu.
// `viewerPersonId`: the viewer's own person, "Du" in the network. `today` (YYYY-MM-DD, the server's) turns the age reached on the next birthday into the age the person is now; the birthday
// chip shows the year of birth when it is known.
export function FriendPage({
  b,
  daysSince,
  allGroups = [],
  others = [],
  today,
  viewerPersonId = "",
}: {
  b: Briefing;
  daysSince: number | null;
  allGroups?: { id: string; name: string }[];
  others?: { id: string; name: string }[];
  today?: string;
  viewerPersonId?: string;
}) {
  const birthday = b.person.birthday;
  const otherDates = b.nextDates.filter((d) => d.kind !== "birthday");
  const { promises, exchanges, giftIdeas } = b.open;
  const roles = roleLine(b.roles, b.person.gender);
  const gender = new Map(b.network.nodes.map((n) => [n.id, n.gender]));
  const drawn =
    b.network.edges.length > 0 &&
    layoutNetwork(b.network, viewerPersonId) !== null;
  const list = (
    <ul className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
      {b.relationships.map((r) => {
        const what = [
          relationLabel(
            r.type,
            r.direction === "out" ? "to" : "from",
            gender.get(r.personId) ?? null,
          ),
          r.note,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={r.id}
            id={anchorId("relationships", r.id)}
            className="flex items-center rounded-2xl bg-surface pr-1 shadow-card"
          >
            <Link
              href={r.url}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-surface-2/60"
            >
              <Face id={r.personId} name={r.name} size={38} />
              <span className="min-w-0">
                <span className="block truncate font-display text-lg leading-tight font-semibold">
                  {r.name}
                  {r.visibility === "private" && (
                    <Lock
                      aria-label={copy.privateItem}
                      className="ml-1.5 inline h-3.5 w-3.5 text-muted"
                    />
                  )}
                </span>
                {what && (
                  <span className="block truncate text-sm text-muted">
                    {what}
                  </span>
                )}
              </span>
            </Link>
            <ItemActions
              table="relationships"
              field="note"
              id={r.id}
              mine={r.mine}
              visibility={r.visibility}
              text={r.note ?? ""}
            />
          </li>
        );
      })}
    </ul>
  );
  return (
    <article>
      <header>
        <div className="flex items-center gap-4">
          <Face
            id={b.person.id}
            name={b.person.name}
            size={80}
            ratio={b.freshness.ratio}
          />
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-tight font-bold">
              {b.person.name}
            </h1>
            {roles && (
              <p
                data-role-line
                className="mt-0.5 font-display text-lg leading-snug text-carbon italic"
              >
                {roles}
              </p>
            )}
          </div>
          <PersonMenu
            id={b.person.id}
            name={b.person.name}
            gender={b.person.gender}
            intervalDays={b.freshness.intervalDays}
            others={others}
          />
        </div>
        <div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip icon={Coffee} label={copy.lastSeen}>
              {daysSince === null ? copy.neverSeen : ago(daysSince)}
            </Chip>
            {birthday && (
              <Chip
                id={anchorId("dates", birthday.id)}
                icon={Cake}
                tone="bg-sun font-bold text-on-sun"
              >
                {dayMonth(birthday.next)}
                {/^\d{4}-/.test(birthday.date) &&
                  ` ${birthday.date.slice(0, 4)}`}
                {birthday.age !== null &&
                  ` · ${copy.ageYears.replace("{n}", String(birthday.next === today ? birthday.age : birthday.age - 1))}`}
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
              <Chip
                key={g.id}
                href={g.url}
                icon={Users}
                label={copy.group}
                tone={groupTint(g.id)}
              >
                {g.name}
                {g.private && (
                  <span title={copy.privateItem} className="inline-flex">
                    <Lock aria-label={copy.privateItem} className="h-3 w-3" />
                  </span>
                )}
              </Chip>
            ))}
            <GroupPicker
              personId={b.person.id}
              personName={b.person.name}
              groups={allGroups}
              member={b.groups.map((g) => g.id)}
            />
          </div>
        </div>
      </header>

      {b.situations.length > 0 && (
        <Section title={copy.now} icon={Sparkles}>
          {b.situations.map((f) => (
            <Tile
              key={f.id}
              id={anchorId("facts", f.id)}
              icon={CATEGORY_ICON[f.category]}
              private={f.visibility === "private"}
              tone={f.nudge ? "bg-sun/25 ring-1 ring-sun" : "bg-surface"}
              actions={
                <ItemActions
                  table="facts"
                  kind="situation"
                  checkAfter={f.checkAfter}
                  {...item(f)}
                />
              }
            >
              <FactText f={f} />
              {f.nudge ? (
                <span className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                  <MessageCircleQuestionMark
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-carbon"
                  />
                  {nudge(f.since, today)}
                </span>
              ) : (
                <span className="text-muted">
                  {" "}
                  · {copy.askFrom.replace("{date}", dayMonth(f.checkAfter))}
                </span>
              )}
            </Tile>
          ))}
        </Section>
      )}

      {b.known.length > 0 && (
        <Section title={copy.known} icon={BookOpen}>
          {b.known.map((f) => (
            <Tile
              key={f.id}
              id={anchorId("facts", f.id)}
              icon={CATEGORY_ICON[f.category]}
              private={f.visibility === "private"}
              actions={
                <ItemActions table="facts" kind="lasting" {...item(f)} />
              }
            >
              <FactText f={f} />
            </Tile>
          ))}
        </Section>
      )}

      {promises.length > 0 && (
        <Section title={copy.promised} icon={Handshake}>
          {promises.map((p) => (
            <Tile
              key={p.id}
              id={anchorId("promises", p.id)}
              icon={Pin}
              private={p.visibility === "private"}
              actions={<ItemActions table="promises" {...item(p)} />}
            >
              {(p.byMe || p.by) && <b>{p.byMe ? copy.byMe : p.by}: </b>}
              {p.text}
              {p.due && (
                <span className="text-muted"> · {shortDay(p.due)}</span>
              )}
            </Tile>
          ))}
        </Section>
      )}

      {giftIdeas.length > 0 && (
        <Section title={copy.giftIdeas} icon={Gift}>
          {giftIdeas.map((g) => (
            <Tile
              key={g.id}
              id={anchorId("exchanges", g.id)}
              icon={Gift}
              private={g.visibility === "private"}
              actions={<ItemActions table="exchanges" {...item(g)} />}
            >
              {g.text}
            </Tile>
          ))}
        </Section>
      )}

      {exchanges.length > 0 && (
        <Section title={copy.stillOpen} icon={ArrowLeftRight}>
          {exchanges.map((e) => (
            <Tile
              key={e.id}
              id={anchorId("exchanges", e.id)}
              icon={EXCHANGE_ICON[e.kind] ?? ArrowLeftRight}
              private={e.visibility === "private"}
              actions={<ItemActions table="exchanges" {...item(e)} />}
            >
              {e.by && <b>{e.by} </b>}
              <span aria-hidden>{e.direction === "to_them" ? "→ " : "← "}</span>
              {e.text}
              {e.amount !== null &&
                ` · ${e.amount}${e.currency ? ` ${e.currency}` : ""}`}
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
                <span
                  title={kindName[c.kind]}
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2"
                >
                  <Icon aria-label={kindName[c.kind]} className="h-4 w-4" />
                </span>
                <div className="min-w-0 text-sm">
                  <b>{shortDay(c.date)}</b> {c.summary}
                  {c.withOthers.length > 0 && (
                    <span className="text-muted">
                      {" "}
                      ·{" "}
                      {copy.withOthers.replace(
                        "{names}",
                        c.withOthers.join(", "),
                      )}
                    </span>
                  )}{" "}
                  <Link
                    href={`/c/${c.id}`}
                    className="ml-1 inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs whitespace-nowrap hover:bg-rule/60"
                  >
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
          {drawn ? (
            <>
              <div className="rounded-2xl bg-surface px-2 py-3 shadow-card">
                <Network network={b.network} viewerPersonId={viewerPersonId} />
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer rounded-full px-1 py-1 text-sm text-muted hover:text-ink">
                  {copy.allLinks.replace("{n}", String(b.relationships.length))}
                </summary>
                <div className="mt-2">{list}</div>
              </details>
            </>
          ) : (
            list
          )}
        </Section>
      )}
    </article>
  );
}

// A fact's text, where it was read from and when, and the screenshot it came from.
function FactText({ f }: { f: Briefing["known"][number] }) {
  return (
    <>
      {f.text}
      {(f.source || f.happenedOn) && (
        <span className="text-muted">
          {" "}
          ·{" "}
          {[f.source, f.happenedOn && dayMonth(f.happenedOn)]
            .filter(Boolean)
            .join(", ")}
        </span>
      )}
      {f.imageUrl && (
        <a
          href={f.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-2 inline-block align-middle"
          title={copy.screenshotOf.replace("{source}", f.source ?? "")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private image behind the sign-in, not for next/image */}
          <img
            src={f.imageUrl}
            alt={copy.screenshot}
            loading="lazy"
            className="h-9 w-9 rounded-md bg-surface-2 object-cover object-top"
          />
        </a>
      )}
    </>
  );
}

// How long nothing was heard of a situation that nudges: from the day its latest news was filed.
function nudge(since: string, today?: string): string {
  const weeks = today
    ? Math.floor((Date.parse(today) - Date.parse(since)) / (7 * 86_400_000))
    : 0;
  return weeks >= 2
    ? copy.nudge.replace("{weeks}", String(weeks))
    : weeks === 1
      ? copy.nudgeWeek
      : copy.nudgeSoon;
}

// What ItemActions needs of an item, and no more: it is a client component, so its props travel to the browser.
const item = (x: {
  id: string;
  mine: boolean;
  visibility: "shared" | "private";
  text: string;
}) => ({ id: x.id, mine: x.mine, visibility: x.visibility, text: x.text });
