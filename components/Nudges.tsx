import Link from "next/link";
import { MessageCircleQuestionMark } from "lucide-react";
import type { DueItem } from "@/backend";
import { copy } from "@/components/copy";
import { Face } from "@/components/Face";
import { Section } from "@/components/Tiles";

// Situations nobody has heard about for a while: "Frag mal nach", each with the person and what was going on, linking to the
// situation on their page. Only what whatsDue gave the viewer, so the partner's private situations never show.
export function Nudges({ items }: { items: DueItem[] }) {
  if (!items.length) return null;
  return (
    <Section title={copy.askAbout} icon={MessageCircleQuestionMark} plain>
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.url}>
            <Link href={s.url} className="flex items-center gap-3 rounded-2xl bg-sun/25 p-3 shadow-card ring-1 ring-sun">
              <Face id={s.personId} name={s.name} size={40} />
              <span className="min-w-0 flex-1">{copy.askAboutWhat.replace("{name}", s.name).replace("{text}", s.text ?? "")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
