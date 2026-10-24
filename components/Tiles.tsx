import { Lock, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { copy } from "@/components/copy";

// The building blocks of the friend and conversation pages. `id` on a chip or a tile is its item's anchor (anchorId()): a link
// ending in it scrolls there and the row is highlighted (`:target` in globals.css).

export function Chip({ id, icon: Icon, label, children }: { id?: string; icon: LucideIcon; label?: string; children: ReactNode }) {
  return (
    <span id={id} title={label} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label && <span className="sr-only">{label}: </span>}
      {children}
    </span>
  );
}

// `list`: the children are <li>; `plain`: one block, no grid.
export function Section({ title, list, plain, children }: { title: string; list?: boolean; plain?: boolean; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">{title}</h2>
      {list ? <ul>{children}</ul> : plain ? children : <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">{children}</div>}
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
    <div id={id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm shadow-card">
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
