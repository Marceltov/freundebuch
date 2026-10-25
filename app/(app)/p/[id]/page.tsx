import { briefing, daysBetween, listGroups, peopleOverview, today } from "@/backend";
import { FriendPage } from "@/components/FriendPage";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const b = await orNotFound(briefing(await pageViewer(), (await params).id));
  return { title: b.person.name };
}

export default async function PersonPage({ params }: PageProps<"/p/[id]">) {
  const v = await pageViewer();
  const b = await orNotFound(briefing(v, (await params).id));
  const seen = b.freshness.lastSeen;
  const groups = (await listGroups(v)).map((g) => ({ id: g.id, name: g.name }));
  const others = (await peopleOverview(v)).filter((p) => p.id !== b.person.id).map((p) => ({ id: p.id, name: p.name }));
  return <FriendPage b={b} daysSince={seen ? daysBetween(seen, today()) : null} allGroups={groups} others={others} today={today()} />;
}
