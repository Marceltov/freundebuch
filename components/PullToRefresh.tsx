"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { copy } from "@/components/copy";

/** How far (px) the indicator must come down before letting go reloads; and the most it ever comes down. */
export const PULL_TRIGGER = 64;
const PULL_MAX = 96;

/** Where the indicator is for a finger `dy` px below where it started: half the way, never past PULL_MAX. */
export function pulled(dy: number): { distance: number; ready: boolean } {
  const distance = Math.min(Math.max(dy, 0) / 2, PULL_MAX);
  return { distance, ready: distance >= PULL_TRIGGER };
}

// Pull-to-refresh, as an app on the home screen gets none from the phone: at the very top of the page, pulling down brings a
// round arrow down after the finger; letting go once it has come far enough reloads the page's data (router.refresh), the arrow
// spinning until it is there. The page itself doesn't bounce (overscroll-behavior in globals.css), so the top bar stays put.
// Inside a sheet or dialog, a pull scrolls that instead.
export function PullToRefresh() {
  const router = useRouter();
  const [distance, setDistance] = useState(0);
  const [refreshing, startRefresh] = useTransition();
  const start = useRef<number | null>(null);
  const ready = useRef(false);

  useEffect(() => {
    const down = (e: TouchEvent) => {
      const inSheet = (e.target as Element | null)?.closest?.('[role="dialog"]');
      start.current = window.scrollY <= 0 && !inSheet && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const p = pulled(e.touches[0].clientY - start.current);
      ready.current = p.ready;
      setDistance(p.distance);
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      setDistance(0);
      if (ready.current) startRefresh(() => router.refresh());
      ready.current = false;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [router]);

  const shown = refreshing ? PULL_TRIGGER : distance;
  if (!shown) return null;
  return (
    <div
      role="status"
      aria-label={refreshing ? copy.refreshing : copy.pullToRefresh}
      className="pointer-events-none fixed inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] z-20 flex justify-center"
      style={{ transform: `translateY(${shown - PULL_TRIGGER / 2}px)`, opacity: Math.min(shown / PULL_TRIGGER, 1) }}
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-float">
        <RefreshCw
          aria-hidden
          className={`h-5 w-5 text-carbon ${refreshing ? "animate-spin" : ""}`}
          style={refreshing ? undefined : { transform: `rotate(${(shown / PULL_TRIGGER) * 270}deg)` }}
        />
      </span>
    </div>
  );
}
