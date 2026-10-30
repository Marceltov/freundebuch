"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { useCopy } from "@/components/i18n";

export type ShareState = "idle" | "shared" | "copied" | "failed";
type Nav = { share?: (data: { title: string; url: string }) => Promise<void>; clipboard: { writeText: (text: string) => Promise<void> } };

/**
 * Hands `url` to the phone's share sheet, or copies it where there is none or it fails. Closing the sheet without picking
 * anyone is no failure: nothing happens.
 */
export async function shareLink(nav: Nav, url: string, title: string): Promise<ShareState> {
  if (nav.share) {
    try {
      await nav.share({ title, url });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "idle";
    }
  }
  return nav.clipboard.writeText(url).then(
    () => "copied",
    () => "failed",
  );
}

/** The absolute link of a page in this app, `path` with an anchor when it points at a row. */
export const linkTo = (path: string) => new URL(path, window.location.origin).toString();

// Sends a link to a page of the app (a person, a conversation, a group), e.g. to the other user, who opens it signed in and
// sees what is shared with them. The icon turns into a tick once the link is shared or copied.
export function ShareButton({ path, title }: { path: string; title: string }) {
  const copy = useCopy();
  const [state, setState] = useState<ShareState>("idle");
  const label = state === "copied" ? copy.linkCopied : state === "failed" ? copy.copyFailed : copy.shareLink;
  const done = state === "copied" || state === "shared";
  return (
    <button
      type="button"
      onClick={async () => setState(await shareLink(navigator, linkTo(path), title))}
      aria-label={label}
      title={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-rule"
    >
      {done ? <Check aria-hidden className="h-5 w-5" /> : <Share2 aria-hidden className="h-5 w-5" />}
    </button>
  );
}
