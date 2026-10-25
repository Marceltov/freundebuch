import { copy } from "@/components/copy";
import { ShareInbox } from "@/components/ShareInbox";

export const metadata = { title: copy.shareTitle };

// Where Android's share sheet lands (via public/sw.js): the shared images are sent on from here.
export default async function SharePage({ searchParams }: PageProps<"/teilen">) {
  const again = (await searchParams).nochmal === "1";
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">{copy.shareTitle}</h1>
      <ShareInbox again={again} />
    </div>
  );
}
