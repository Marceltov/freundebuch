#!/bin/sh
# Regenerates everything derived from the API's route table (backend/http/api.ts). Commit the result;
# CI runs this and fails on any difference.
set -e
cd "$(dirname "$0")/.."

# openapi.json, from the route table (vitest resolves backend/'s TypeScript imports).
UPDATE_OPENAPI=1 npx vitest run backend/http/openapi.test.ts --silent >/dev/null
