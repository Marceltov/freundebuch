import Link from "next/link";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { copy } from "@/components/copy";

// The frame of every signed-in page: a slim top bar (the name, which leads home, and the settings cog), then one column,
// phone width first and at most max-w-2xl on a desktop.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <div className="sticky top-0 z-30 flex items-center justify-between bg-paper/95 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
        <Link href="/" aria-label={copy.home} className="text-lg font-bold tracking-tight">
          {copy.appName}
        </Link>
        <Link href="/einstellungen" aria-label={copy.settings} title={copy.settings} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink">
          <Settings aria-hidden className="h-5 w-5" />
        </Link>
      </div>
      <main className="min-w-0 px-4 pt-2 pb-16">{children}</main>
    </div>
  );
}
