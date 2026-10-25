"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarHeart, History, House, Users, type LucideIcon } from "lucide-react";
import { copy } from "@/components/copy";

// The four places, floating at the bottom on a phone: the current one in the accent. A friend's page counts as Leute, a
// conversation as Verlauf, a group as Start (where groups filter the orbit).
const TABS: { href: string; label: string; icon: LucideIcon; also: string[] }[] = [
  { href: "/", label: copy.tabStart, icon: House, also: ["/g/"] },
  { href: "/verlauf", label: copy.tabHistory, icon: History, also: ["/c/"] },
  { href: "/leute", label: copy.tabPeople, icon: Users, also: ["/p/"] },
  { href: "/bald", label: copy.tabSoon, icon: CalendarHeart, also: [] },
];

export function TabBar() {
  const path = usePathname();
  const current = (t: (typeof TABS)[number]) => (t.href === "/" ? path === "/" : path.startsWith(t.href)) || t.also.some((p) => path.startsWith(p));
  return (
    <nav
      aria-label={copy.mainMenu}
      className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-2xl px-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]"
    >
      <ul className="grid grid-cols-4 rounded-3xl bg-surface p-1.5 shadow-float">
        {TABS.map((t) => {
          const on = current(t);
          return (
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
        })}
      </ul>
    </nav>
  );
}
