import { AppShell } from "@/components/AppShell";
import { pageViewer } from "./viewer";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell userId={(await pageViewer()).userId}>{children}</AppShell>;
}
