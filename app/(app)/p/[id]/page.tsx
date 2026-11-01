import { briefing, chatEnabled, daysBetween, listBooks, listGroups, memberUsers, peopleOverview, today } from "@/backend";
import { FriendPage } from "@/components/FriendPage";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const b = await orNotFound(briefing(await pageViewer((await params).id), (await params).id));
  return { title: b.person.name };
}

export default async function PersonPage({ params, searchParams }: PageProps<"/p/[id]">) {
  const v = await pageViewer((await params).id);
  const b = await orNotFound(briefing(v, (await params).id));
  const seen = b.freshness.lastSeen;
  const groups = (await listGroups(v)).map((g) => ({ id: g.id, name: g.name }));
  const books = await listBooks(v);
  const isMember = (await memberUsers(v)).has(b.person.id);
  const stayed = (await searchParams).blieb;
  const others = (await peopleOverview(v)).filter((p) => p.id !== b.person.id).map((p) => ({ id: p.id, name: p.name }));
  return (
    <FriendPage
      b={b}
      daysSince={seen ? daysBetween(seen, today()) : null}
      allGroups={groups}
      others={others}
      today={today()}
      viewerPersonId={v.personId}
      bookId={v.bookId}
      bookName={books.length > 1 ? books.find((x) => x.id === v.bookId)?.name : undefined}
      books={books.map((x) => ({ id: x.id, name: x.name }))}
      movable={!isMember}
      stayedIn={typeof stayed === "string" ? stayed : undefined}
      chat={chatEnabled()}
    />
  );
}
