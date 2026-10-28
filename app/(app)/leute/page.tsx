import { daysBetween, listGroups, peopleOverview, today } from "@/backend";
import { copy } from "@/components/copy";
import { ago } from "@/components/format";
import { PeopleList } from "@/components/PeopleList";
import { pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.tabPeople };

// Everyone in the book, not only who the orbit shows.
export default async function PeoplePage() {
  const v = await pageViewer();
  const now = today();
  const [people, groups] = await Promise.all([peopleOverview(v), listGroups(v)]);
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.tabPeople}</h1>
      <PeopleList
        people={people.map((p) => ({
          id: p.id,
          name: p.name,
          aliases: p.aliases,
          url: p.url,
          groups: p.groups,
          household: p.household,
          seen: p.lastSeen ? ago(daysBetween(p.lastSeen, now)) : copy.neverMet,
        }))}
        groups={groups.filter((g) => g.count > 0).map((g) => ({ id: g.id, name: g.name, count: g.count }))}
      />
    </div>
  );
}
