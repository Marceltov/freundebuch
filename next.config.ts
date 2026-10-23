import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pino stays a plain Node require (it is on Next's own list too), so the standalone build traces it into node_modules.
  // better-sqlite3 (a native module) the same: a plain require, so its prebuilt binding is traced along.
  serverExternalPackages: ["pino", "better-sqlite3"],
  // The OAuth login hands a code to whatever host the client registered: no framing it (clickjacking the
  // sign-in and the "Allow" click).
  headers: async () => [{ source: "/oauth/authorize", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }],
  // freundebuch doesn't use next/image, so leave out sharp and its LGPL libvips binaries.
  outputFileTracingExcludes: {
    "*": ["node_modules/sharp/**", "node_modules/@img/**"],
  },
};

export default nextConfig;
