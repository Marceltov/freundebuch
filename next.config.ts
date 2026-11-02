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
  // freundebuch doesn't use next/image: the optimizer stays off (no endpoint to attack), and sharp and its LGPL libvips binaries stay out.
  images: { unoptimized: true },
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
