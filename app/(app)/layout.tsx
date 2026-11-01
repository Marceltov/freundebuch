import { looksAcross, pendingCount, sharingEnabled } from "@/backend";
import { AppShell } from "@/components/AppShell";
import { LooksProvider } from "@/components/Looks";
import { pageViewer } from "./viewer";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const v = await pageViewer();
  return (
    <LooksProvider looks={await looksAcross(v)}>
      <AppShell userId={v.userId} pending={sharingEnabled() ? await pendingCount(v) : 0}>
        {children}
      </AppShell>
    </LooksProvider>
  );
}
