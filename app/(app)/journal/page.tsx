import { journalAcross } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { Journal } from "@/components/Journal";
import { pageCopy, pageViewer } from "../viewer";
import { withBookName } from "@/components/bookName";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).journal });

// The viewer's own journal: every entry Claude cut from their rambles, in all their books, newest first, by month. Private
// unless they shared one.
export default async function JournalPage() {
  const v = await pageViewer();
  const copy = getCopy();
  const entries = withBookName(await journalAcross(v, { from: "0000-01-01", to: "9999-12-31", own: true }), v.books.length > 1);
  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{copy.journal}</h1>
      <p className="mt-1 text-sm text-muted">{copy.journalHint}</p>
      <Journal entries={entries} />
    </div>
  );
}
