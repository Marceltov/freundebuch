import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { copy } from "@/components/copy";

// The building blocks of the friend and conversation pages. `id` on a chip or a tile is its item's anchor (anchorId()): a link
// ending in it scrolls there and the row is highlighted (`:target` in globals.css).

// `href`: the chip is a link, e.g. a group chip to the group's page. `tone`: its fill, the surface by default.
export function Chip({
  id,
  href,
  icon: Icon,
  label,
  tone = "bg-surface-2",
  children,
}: {
  id?: string;
  href?: string;
  icon: LucideIcon;
  label?: string;
  tone?: string;
  children: ReactNode;
}) {
  const inner = (
    <>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label && <span className="sr-only">{label}: </span>}
      {children}
    </>
  );
  const cls = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${tone}`;
  return href ? (
    <Link id={id} href={href} title={label} className={`${cls} hover:brightness-95`}>
      {inner}
    </Link>
  ) : (
    <span id={id} title={label} className={cls}>
      {inner}
    </span>
  );
}

// A field of the book: its heading in the display face with an icon, its rows one under the other, read like lines on a page.
// `list`: the children are <li>; `plain`: one block as it is.
export function Section({ title, icon: Icon, list, plain, children }: { title: string; icon?: LucideIcon; list?: boolean; plain?: boolean; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
        {Icon && <Icon aria-hidden className="h-[18px] w-[18px] text-carbon" />}
        {title}
      </h2>
      {list ? <ul>{children}</ul> : plain ? children : <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}

// An icon tile: the item's icon, its text (with a lock for a private one), and its actions. `closed`: what the item is no longer
// (Erledigt, Veraltet), shown after its text, which is then muted.
export function Tile({
  id,
  icon: Icon,
  private: priv,
  closed,
  actions,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  private: boolean;
  closed?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-3 py-2.5 text-[15px] shadow-card">
      <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 opacity-75" />
      <span className={`min-w-0 flex-1 ${closed ? "text-muted" : ""}`}>
        {children}
        {priv && (
          <span title={copy.privateItem} className="ml-1 inline-flex align-[-2px] text-muted">
            <Lock aria-label={copy.privateItem} className="h-3.5 w-3.5" />
          </span>
        )}
        {closed && <span className="ml-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs whitespace-nowrap">{closed}</span>}
      </span>
      {actions}
    </div>
  );
}

// A group's own soft tint, the same every time: one of four, picked by its id.
const TINTS = ["bg-g1", "bg-g2", "bg-g3", "bg-g4"] as const;
export function groupTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}
