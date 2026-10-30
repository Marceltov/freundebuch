"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarHeart, History, House, MessageCirclePlus, Users, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatSheet } from "@/components/ChatSheet";
import { copy } from "@/components/copy";

// The four places, floating at the bottom on a phone: the current one in the accent. A friend's page counts as Leute, a
// conversation as Verlauf, a group as Start (where groups filter the orbit). With `chat` (an API key is set), a raised
// "Erzählen" button in the middle opens the chat over the current page.
const TABS: { href: string; label: string; icon: LucideIcon; also: string[] }[] = [
  { href: "/", label: copy.tabStart, icon: House, also: ["/g/"] },
  { href: "/verlauf", label: copy.tabHistory, icon: History, also: ["/c/"] },
  { href: "/leute", label: copy.tabPeople, icon: Users, also: ["/p/"] },
  { href: "/bald", label: copy.tabSoon, icon: CalendarHeart, also: [] },
];

const TELL_FILE = "freundebuch:tell-file";
/** Opens Erzählen on shared files waiting under Prüfen, to work them through together (in this order). */
export const tellAbout = (fileIds: string[]) => window.dispatchEvent(new CustomEvent(TELL_FILE, { detail: fileIds }));

export function TabBar({ chat = null }: { chat?: { userId: string; sharing: boolean; voice?: boolean } | null }) {
  const path = usePathname();
  const [talking, setTalking] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const tellButton = useRef<HTMLButtonElement>(null);
  // Closing the chat hands the keyboard back to the button that opened it.
  const closeChat = useCallback(() => {
    setTalking(false);
    setFiles([]);
    tellButton.current?.focus();
  }, []);
  // "In Erzählen öffnen" or "Zusammen prüfen" under Prüfen opens the chat on those files (tellAbout).
  useEffect(() => {
    const open = (e: Event) => {
      setFiles((e as CustomEvent<string[]>).detail);
      setTalking(true);
    };
    window.addEventListener(TELL_FILE, open);
    return () => window.removeEventListener(TELL_FILE, open);
  }, []);
  const current = (t: (typeof TABS)[number]) => (t.href === "/" ? path === "/" : path.startsWith(t.href)) || t.also.some((p) => path.startsWith(p));
  return (
    <nav
      aria-label={copy.mainMenu}
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl px-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]"
    >
      <ul className={`grid ${chat ? "grid-cols-5" : "grid-cols-4"} rounded-3xl bg-surface p-1.5 shadow-float`}>
        {TABS.flatMap((t, i) => {
          const on = current(t);
          const tab = (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-2xl py-1.5 text-xs ${on ? "bg-carbon/12 font-bold text-carbon" : "text-muted hover:text-ink"}`}
              >
                <t.icon aria-hidden className="h-5 w-5" strokeWidth={on ? 2.4 : 2} />
                {t.label}
              </Link>
            </li>
          );
          if (!chat || i !== 2) return [tab];
          return [
            <li key="tell" className="flex justify-center">
              <button
                ref={tellButton}
                type="button"
                onClick={() => setTalking(true)}
                className="-mt-5 flex flex-col items-center gap-0.5 text-xs font-bold text-carbon"
              >
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-carbon text-on-carbon shadow-float ring-4 ring-paper">
                  <MessageCirclePlus aria-hidden className="h-6 w-6" />
                </span>
                {copy.tell}
              </button>
            </li>,
            tab,
          ];
        })}
      </ul>
      {talking && chat && <ChatSheet key={files.join() || "chat"} userId={chat.userId} sharing={chat.sharing} voice={chat.voice} files={files} onClose={closeChat} />}
    </nav>
  );
}
