import Link from "next/link";
import { headers } from "next/headers";
import { getPerson, hasRecorded, listGroups, mcpResource, orbit, whatsDue } from "@/backend";
import { copy } from "@/components/copy";
import { CopyField } from "@/components/CopyButton";
import { GroupFilter } from "@/components/GroupFilter";
import { Orbit } from "@/components/Orbit";
import { pageViewer } from "./viewer";

export const dynamic = "force-dynamic";

// The start page: a greeting that says who would be glad to hear from the viewer, the viewer's orbit, filtered by a group when
// one is chosen (?gruppe=<id>), with that group's due people below; before anything is recorded, how to connect Claude.
export default async function OrbitPage({ searchParams }: PageProps<"/">) {
  const v = await pageViewer();
  const groups = (await listGroups(v)).filter((g) => g.count > 0);
  const wanted = (await searchParams).gruppe;
  const group = groups.find((g) => g.id === wanted) ?? null;
  const faces = await orbit(v, undefined, group?.id);
  if (!faces.length)
    return (
      <div className="mt-8 rounded-2xl bg-surface p-5 shadow-card">
        <p>{copy.orbitEmpty}</p>
        <p className="mt-4 mb-1.5 font-display font-semibold">{copy.mcpUrl}</p>
        <CopyField label={copy.mcpUrl} text={mcpResource(await headers())} />
      </div>
    );
  const due = group ? faces.filter((f) => f.inGroup && f.ring === 2) : [];
  const [me, waiting, recorded] = await Promise.all([
    getPerson(v, v.personId).catch(() => null),
    whatsDue(v).then((d) => d.filter((i) => i.kind === "overdue").length),
    hasRecorded(v),
  ]);
  const first = me?.name.trim().split(/\s+/)[0];
  return (
    <>
      <h1 className="font-display text-3xl font-bold">{first ? copy.hello.replace("{name}", first) : copy.helloAnon}</h1>
      <p className="mb-3 text-muted">{waiting === 0 ? copy.nobodyWaiting : waiting === 1 ? copy.oneWaiting : copy.manyWaiting.replace("{n}", String(waiting))}</p>
      {groups.length > 0 && <GroupFilter groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.count }))} current={group?.id ?? null} />}
      <Orbit faces={faces} />
      {!recorded && (
        <div className="mt-4 rounded-2xl bg-surface p-4 shadow-card">
          <p>{copy.startTelling}</p>
          <div className="mt-2">
            <CopyField label={copy.mcpUrl} text={mcpResource(await headers())} />
          </div>
        </div>
      )}
      {due.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-2 font-display text-lg font-semibold">{copy.groupDue.replace("{name}", group!.name)}</h2>
          <ul>
            {due.map((f) => (
              <li key={f.personId} className="border-b border-rule">
                <Link href={f.url} className="flex items-center gap-2 py-2">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--due)" }} />
                  {f.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
