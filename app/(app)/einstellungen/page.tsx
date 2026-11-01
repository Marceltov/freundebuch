import { headers } from "next/headers";
import { BookOpen, CalendarDays, IdCard, ImageUp, LogOut, Plug, Sparkles, Users } from "lucide-react";
import {
  acrossBooks,
  getReflection,
  getSettings,
  hasCalendarKey,
  hasShareKey,
  inBook,
  listBooks,
  listGroups,
  listInvitations,
  ownCards,
  mcpResource,
  publicUrl,
  sharingEnabled,
} from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { CopyField } from "@/components/CopyButton";
import { GroupSettings } from "@/components/GroupSettings";
import { Books } from "@/components/Books";
import { BookMark } from "@/components/BookMark";
import { OwnCardsSettings } from "@/components/Cards";
import { CalendarSettings, LanguageSettings, ReflectionSettings, ShareSettings, WebhookSettings } from "@/components/Settings";
import { pageCopy, pageViewer } from "../viewer";

export const dynamic = "force-dynamic";

export const generateMetadata = async () => ({ title: (await pageCopy()).settings });

// The viewer's own settings: the webhook for reminders, the weekly reflection, sharing files (when the instance can read them), the calendar
// feed, their books (members, roles, invitations), the groups of each book with their other names, and the address to connect Claude with. The time of day the reminders go out is the
// instance's (FREUNDEBUCH_NOTIFY_AT), not a setting here.
export default async function SettingsPage() {
  const v = await pageViewer();
  const copy = getCopy();
  const { webhookUrl } = await getSettings(v);
  const books = await listBooks(v);
  const invitations = Object.fromEntries(
    await Promise.all(books.filter((b) => b.role !== "member").map(async (b) => [b.id, await listInvitations(await inBook(v, b.id))] as const)),
  );
  const groups = await acrossBooks(v, listGroups);
  const several = books.length > 1;
  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-bold">{copy.settings}</h1>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <LanguageSettings />
      </section>
      <section id="buecher" className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
          <BookOpen aria-hidden className="h-4 w-4" />
          {copy.books}
        </h2>
        <Books books={books} invitations={invitations} me={v.userId} />
      </section>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <WebhookSettings webhookUrl={webhookUrl} />
      </section>
      <section id="rueckblick" className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
          <Sparkles aria-hidden className="h-4 w-4" />
          {copy.reflectionTitle}
        </h2>
        <ReflectionSettings reflection={await getReflection(v)} hasWebhook={!!webhookUrl} />
      </section>
      {sharingEnabled() && (
        <section id="teilen" className="rounded-2xl bg-surface p-5 shadow-card">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
            <ImageUp aria-hidden className="h-4 w-4" />
            {copy.shareTitle}
          </h2>
          <ShareSettings hasKey={await hasShareKey(v)} shareUrl={`${publicUrl(await headers())}/api/share`} />
        </section>
      )}
      <section id="karte" className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
          <IdCard aria-hidden className="h-4 w-4" />
          {copy.ownCardTitle}
        </h2>
        <OwnCardsSettings cards={await ownCards(v)} />
      </section>
      <section id="kalender" className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
          <CalendarDays aria-hidden className="h-4 w-4" />
          {copy.calendarTitle}
        </h2>
        <CalendarSettings hasFeed={await hasCalendarKey(v)} />
      </section>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Users aria-hidden className="h-4 w-4" />
          {copy.groups}
        </h2>
        <p className="mt-1 mb-3 text-sm text-muted">{copy.groupsHint}</p>
        {books.map((b) => (
          <div key={b.id} className="mt-3 first:mt-0">
            {several && <BookMark name={b.name} />}
            <GroupSettings
              groups={groups
                .filter((g) => g.book.id === b.id)
                .map((g) => ({ id: g.id, name: g.name, aliases: g.aliases, count: g.count, household: g.household }))}
            />
          </div>
        ))}
      </section>
      <section className="rounded-2xl bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
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
