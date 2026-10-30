import Link from "next/link";
import { HeartHandshake, Lock } from "lucide-react";
import { daysBetween, getGroup, today, traitsFor } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { Face } from "@/components/Face";
import { ShareButton } from "@/components/ShareButton";
import { ago } from "@/components/format";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/g/[id]">) {
  const g = await orNotFound(getGroup(await pageViewer(), (await params).id));
  return { title: g.name };
}

// One group: its name and other names, and everyone in it the viewer may see, never seen or most overdue first, each with the
// orbit's freshness ring and when the viewer last saw them; then what those of them with traits need and how they are.
export default async function GroupPage({ params }: PageProps<"/g/[id]">) {
  const viewer = await pageViewer();
  const copy = getCopy();
  const g = await orNotFound(getGroup(viewer, (await params).id));
  // Who to keep in mind when planning something with the group: only the members with a trait, needs first.
  // The group may be gone or private by now: that is not found, as above.
  const traits = g.members.length ? (await orNotFound(traitsFor(viewer, { groups: [g.id] }))).filter((p) => p.needs.length + p.personality.length > 0) : [];
  const now = today();
  return (
    <article>
      <p className="text-sm text-muted">{copy.groupPage}</p>
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 font-display text-3xl leading-tight font-bold">{g.name}</h1>
        <ShareButton path={g.url} title={g.name} />
      </div>
      <p className="text-sm text-muted">
        {g.aliases.length > 0 && `${copy.alsoCalled.replace("{names}", g.aliases.join(", "))} · `}
        {g.count === 1 ? copy.onePerson : copy.people.replace("{n}", String(g.count))}
      </p>
      <section className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold">{copy.members}</h2>
        {g.members.length === 0 ? (
          <p className="text-muted">{copy.noMembers}</p>
        ) : (
          <ul>
            {g.members.map((m) => (
              <li key={m.personId} className="border-b border-rule">
                <Link href={m.url} className="flex items-center gap-3 py-2">
                  <Face id={m.personId} name={m.name} size={36} ratio={m.ratio} />
                  <span className="min-w-0 flex-1">
                    {m.name}
                    {m.private && <Lock aria-label={copy.privateItem} className="ml-1 inline h-3.5 w-3.5 text-muted" />}
                    <span className="block text-xs text-muted">
                      {copy.lastSeen}: {m.lastSeen ? ago(copy, daysBetween(m.lastSeen, now)) : copy.neverSeen}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {traits.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
            <HeartHandshake aria-hidden className="h-[18px] w-[18px] text-carbon" />
            {copy.traits}
          </h2>
          <ul>
            {traits.map((p) => (
              <li key={p.id} className="border-b border-rule py-2">
                <Link href={p.url} className="font-semibold">
                  {p.name}
                </Link>
                {(
                  [
                    [copy.needs, p.needs],
                    [copy.personality, p.personality],
                  ] as const
                ).map(
                  ([title, facts]) =>
                    facts.length > 0 && (
                      <p key={title} className="text-sm">
                        <span className="text-muted">{title}: </span>
                        {facts.map((f) => f.text).join(", ")}
                      </p>
                    ),
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
