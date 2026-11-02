import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino stays a plain Node require (it is on Next's own list too), so the standalone build traces it into node_modules.
  // better-sqlite3 (a native module) the same: a plain require, so its prebuilt binding is traced along. libheif-js too: its
  // 2 MB WebAssembly bundle is loaded only when a HEIC comes in (backend/conversations/heic.ts), not bundled into the server chunks.
  serverExternalPackages: ["pino", "better-sqlite3", "libheif-js"],
  // The OAuth login hands a code to whatever host the client registered: no framing it (clickjacking the
  // sign-in and the "Allow" click).
  headers: async () => [{ source: "/oauth/authorize", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }],
  // The pages had German paths until #122. Links to them live on in Claude chats, sent invitations, notifications and
  // installed apps: they go on to the English ones for good (308, so the share target's POST stays a POST).
  redirects: async () =>
    [
      ["/leute", "/people"],
      ["/bald", "/soon"],
      ["/verlauf", "/history"],
      ["/tagebuch", "/journal"],
      ["/einstellungen", "/settings"],
      ["/pruefen", "/review"],
      ["/teilen/eingang", "/share/inbox"],
      ["/teilen", "/share"],
      ["/einladung/:token", "/invite/:token"],
    ].map(([source, destination]) => ({ source, destination, permanent: true })),
  // freundebuch doesn't use next/image: the optimizer stays off (no endpoint to attack), and sharp and its LGPL libvips binaries stay out.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
