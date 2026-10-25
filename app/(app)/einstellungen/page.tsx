import { headers } from "next/headers";
import { LogOut, Plug, Users } from "lucide-react";
import { getSettings, listGroups, mcpResource } from "@/backend";
import { copy } from "@/components/copy";
import { CopyField } from "@/components/CopyButton";
import { GroupSettings } from "@/components/GroupSettings";
import { WebhookSettings } from "@/components/Settings";
import { pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const metadata = { title: copy.settings };

// The viewer's own settings: the webhook for reminders, the groups with their other names, and the address to connect Claude with. The time of day the
// reminders go out is the instance's (FREUNDEBUCH_NOTIFY_AT), not a setting here.
export default async function SettingsPage() {
  const v = await pageViewer();
  const { webhookUrl } = await getSettings(v);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{copy.settings}</h1>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <WebhookSettings webhookUrl={webhookUrl} />
      </section>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-bold">
          <Users aria-hidden className="h-4 w-4" />
          {copy.groups}
        </h2>
        <p className="mt-1 mb-3 text-sm text-muted">{copy.groupsHint}</p>
        <GroupSettings groups={(await listGroups(v)).map((g) => ({ id: g.id, name: g.name, aliases: g.aliases, count: g.count }))} />
      </section>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-bold">
          <Plug aria-hidden className="h-4 w-4" />
          {copy.mcpUrl}
        </h2>
        <p className="mt-1 mb-2 text-sm text-muted">{copy.mcpHint}</p>
        <CopyField label={copy.mcpUrl} text={mcpResource(await headers())} />
      </section>
      <form method="post" action="/logout">
        <button type="submit" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-ink">
          <LogOut aria-hidden className="h-4 w-4" />
          {copy.logout}
        </button>
      </form>
    </div>
  );
}
