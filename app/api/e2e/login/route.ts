import { e2eLoginRoute } from "@/backend";

// The Playwright tests' sign-in; a 404 unless FREUNDEBUCH_E2E=1 in a dev server (see backend/auth/e2e.ts).
export const GET = e2eLoginRoute;
