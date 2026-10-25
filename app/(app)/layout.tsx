import { pendingCount, sharingEnabled } from "@/backend";
import { AppShell } from "@/components/AppShell";
import { pageViewer } from "./viewer";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const v = await pageViewer();
  return (
    <AppShell userId={v.userId} pending={sharingEnabled() ? await pendingCount(v) : 0}>
      {children}
    </AppShell>
  );
}
