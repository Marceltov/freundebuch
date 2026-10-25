import { listPending } from "@/backend";
import { copy } from "@/components/copy";
import { PendingList } from "@/components/Pending";
import { pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.pending };

// The viewer's own shared screenshots that wait for them (backend/screenshots.ts). The partner's never show here.
export default async function PendingPage() {
  const pending = await listPending(await pageViewer());
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">{copy.pending}</h1>
      <p className="text-sm text-muted">{copy.pendingHint}</p>
      {pending.length === 0 ? <p className="rounded-2xl bg-surface p-5 shadow-card">{copy.pendingEmpty}</p> : <PendingList items={pending} />}
    </div>
  );
}
