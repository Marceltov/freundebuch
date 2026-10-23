# Build: full deps, next build (standalone output). Debian like the runtime image, so the build sees the same libc.
FROM node:22-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No install scripts: better-sqlite3 has a binding.gyp, so npm would compile it with node-gyp, and the image has no compiler. Its prebuilt
# binaries (x64 and arm64) are in the package and are what it loads; nothing else in the build needs a script (unrs-resolver is for eslint).
RUN npm ci --ignore-scripts
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && mkdir /data

# Runtime: only the standalone server and its traced deps; no full node_modules. Distroless: Node and the libraries it links against,
# and no shell, package manager or npm, so nothing of that kind can be vulnerable or be used by someone who got in.
FROM gcr.io/distroless/nodejs22-debian13
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=1000:1000 /app/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/.next/static ./.next/static
COPY --from=build --chown=1000:1000 /data /data
COPY docker-entrypoint.mjs ./
VOLUME /data
EXPOSE 3000
# GET /health (backend/http/health.ts): `docker ps` and monitors that read Docker's health status show it. A 503 is unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Starts as root only to switch to the owner of /data (see docker-entrypoint.mjs).
ENTRYPOINT ["/nodejs/bin/node", "docker-entrypoint.mjs"]
