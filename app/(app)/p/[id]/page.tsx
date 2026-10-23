import { briefing, daysBetween, today } from "@/backend";
import { FriendPage } from "@/components/FriendPage";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const b = await orNotFound(briefing(await pageViewer(), (await params).id));
  return { title: b.person.name };
}

export default async function PersonPage({ params }: PageProps<"/p/[id]">) {
  const b = await orNotFound(briefing(await pageViewer(), (await params).id));
  const seen = b.freshness.lastSeen;
  return <FriendPage b={b} daysSince={seen ? daysBetween(seen, today()) : null} />;
}
