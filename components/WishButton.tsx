"use client";

import { PartyPopper } from "lucide-react";
import { useCopy } from "@/components/i18n";
import { askChat } from "@/components/TabBar";

/** "Glückwunsch schreiben" by a birthday that is near: Erzählen opens on the person with the request in the field. Claude drafts
 * the wishes, and the user sends them from their own app (birthday_message); freundebuch sends nothing. */
export function WishButton({ name }: { name: string }) {
  const copy = useCopy();
  return (
    <button
      type="button"
      onClick={() => askChat(copy.wishAsk.replace("{name}", name))}
      className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-3 py-1 text-sm font-bold text-on-carbon"
    >
      <PartyPopper aria-hidden className="h-4 w-4" />
      {copy.wishWrite}
    </button>
  );
}
