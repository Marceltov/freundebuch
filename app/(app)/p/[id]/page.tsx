import { chatEnabled, daysBetween, inBook, linkedBriefing, listBooks, listGroups, memberUsers, peopleOverview, today } from "@/backend";
import { FriendPage } from "@/components/FriendPage";
import { orNotFound, pageViewer } from "../../viewer";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/p/[id]">) {
  const b = await orNotFound(linkedBriefing(await pageViewer(), (await params).id));
  return { title: b.person.name };
}

// A person across the user's books: the URL of any of their rows shows the one page of all of them (linkedBriefing). What
// the page adds goes to the part of the book `?in=` names, the oldest by default.
export default async function PersonPage({ params, searchParams }: PageProps<"/p/[id]">) {
  const v = await pageViewer();
  const b = await orNotFound(linkedBriefing(v, (await params).id));
  const wanted = (await searchParams).in;
  const target = b.parts.find((p) => p.book.id === wanted) ?? b.parts[0];
  const w = await inBook(v, target.book.id);
  const seen = b.freshness.lastSeen;
  const groups = (await listGroups(w)).map((g) => ({ id: g.id, name: g.name }));
  const books = await listBooks(v);
  const isMember = (await memberUsers(w)).has(target.id);
  const others = (await peopleOverview(w)).filter((p) => p.id !== target.id).map((p) => ({ id: p.id, name: p.name }));
  // "Du" in the network: the user's own person in the book its drawing starts from, the oldest part's.
  const me = (await inBook(v, b.parts[0].book.id)).personId;
  return (
    <FriendPage
      b={b}
      daysSince={seen ? daysBetween(seen, today()) : null}
      allGroups={groups}
      others={others}
      today={today()}
      viewerPersonId={me}
      bookId={target.book.id}
      several={books.length > 1}
      addInto={target.book.id}
      books={books.map((x) => ({ id: x.id, name: x.name }))}
      movable={!isMember}
      chat={chatEnabled()}
    />
  );
}
