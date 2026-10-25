"use client";

import { useEffect } from "react";

// Registers public/sw.js, which lets an installed freundebuch on Android take shared images (see app/manifest.ts).
export function ShareWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
