import Link from "next/link";
import { ImageUp, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { chatEnabled, sharingEnabled } from "@/backend";
import { copy } from "@/components/copy";
import { PullToRefresh } from "@/components/PullToRefresh";
import { ShareWorker } from "@/components/ShareWorker";
import { TabBar } from "@/components/TabBar";

// The frame of every signed-in page: a slim top bar (the name, which leads home, and the settings cog), one column, phone
// width first and at most max-w-2xl on a desktop, and the tab bar floating at the bottom. Pulling down at the top reloads. `userId` keeps the chat apart per user.
// `pending`: how many shared screenshots wait for the viewer; a badge next to the cog leads there.
export function AppShell({ userId, pending = 0, children }: { userId: string; pending?: number; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <div className="sticky top-0 z-30 flex items-center justify-between bg-paper/70 backdrop-blur-md px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Link href="/" aria-label={copy.home} className="font-display text-xl font-bold">
          freunde<span className="text-carbon">buch</span>
        </Link>
        <div className="flex items-center gap-1">
          {pending > 0 && (
            <Link href="/pruefen" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-carbon/12 px-3 text-sm font-bold text-carbon hover:bg-carbon/20">
              <ImageUp aria-hidden className="h-4 w-4" />
              {copy.pendingCount.replace("{n}", String(pending))}
            </Link>
          )}
          <Link href="/einstellungen" aria-label={copy.settings} title={copy.settings} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
            <Settings aria-hidden className="h-5 w-5" />
          </Link>
        </div>
      </div>
      <PullToRefresh />
      <main className="min-w-0 px-4 pt-2 pb-32">{children}</main>
      <TabBar chat={chatEnabled() ? { userId, sharing: sharingEnabled() } : null} />
      {sharingEnabled() && <ShareWorker />}
    </div>
  );
}
