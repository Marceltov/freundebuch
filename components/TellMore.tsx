"use client";

import { MessageCirclePlus } from "lucide-react";
import { copy } from "@/components/copy";
import { openChat } from "@/components/TabBar";

/** "Weitererzählen" on a ramble's page: Erzählen opens on it, to add to what was told or correct what was filed. */
export function TellMore() {
  return (
    <button type="button" onClick={openChat} className="inline-flex items-center gap-1.5 rounded-full bg-carbon px-3 py-1.5 text-sm font-bold text-on-carbon">
      <MessageCirclePlus aria-hidden className="h-4 w-4" />
      {copy.tellMore}
    </button>
  );
}
