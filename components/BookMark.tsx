"use client";

import { useCopy } from "@/components/i18n";

// The book an entry is in, shown only to someone with two or more books (the page decides and passes the name or nothing).
export function BookMark({ name }: { name: string }) {
  const copy = useCopy();
  return (
    <span
      aria-label={copy.bookMark.replace("{name}", name)}
      className="inline-block shrink-0 rounded-full border border-rule px-1.5 text-xs leading-5 text-muted"
    >
      {name}
    </span>
  );
}
