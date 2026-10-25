import Link from "next/link";
import { Lock } from "lucide-react";
import { daysBetween, getGroup, today } from "@/backend";
import { copy } from "@/components/copy";
import { Face } from "@/components/Face";
import { ago } from "@/components/format";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/g/[id]">) {
  const g = await orNotFound(getGroup(await pageViewer(), (await params).id));
  return { title: g.name };
}

// One group: its name and other names, and everyone in it the viewer may see, never seen or most overdue first, each with the
// orbit's freshness ring and when the viewer last saw them.
export default async function GroupPage({ params }: PageProps<"/g/[id]">) {
  const g = await orNotFound(getGroup(await pageViewer(), (await params).id));
  const now = today();
  return (
    <article>
      <p className="text-sm text-muted">{copy.groupPage}</p>
      <h1 className="font-display text-3xl leading-tight font-bold">{g.name}</h1>
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
                      {copy.lastSeen}: {m.lastSeen ? ago(daysBetween(m.lastSeen, now)) : copy.neverSeen}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
