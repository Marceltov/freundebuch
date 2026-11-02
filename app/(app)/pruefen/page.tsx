import { listPending } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { PendingList } from "@/components/Pending";
import { pageCopy, pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).pending });

// The viewer's own shared files that wait for them, in all their books (backend/conversations/files.ts). The partner's never show
// here. No book mark: Claude files each into the book it belongs to, whichever it waits in.
export default async function PendingPage() {
  const pending = await listPending(await pageViewer());
  const copy = getCopy();
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">{copy.pending}</h1>
      <p className="text-sm text-muted">{copy.pendingHint}</p>
      {pending.length === 0 ? <p className="rounded-2xl bg-surface p-5 shadow-card">{copy.pendingEmpty}</p> : <PendingList items={pending} />}
    </div>
  );
}
