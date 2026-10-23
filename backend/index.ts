// The backend's boundary: the only module the frontend (app/, components/, proxy.ts) may import from
// backend/ (enforced in eslint.config.mjs). Calls are in-process today. Each query below is shaped like
// the endpoint it would become if the backend moved out, so the cut would be here and nowhere else.
import { sql } from "kysely";
import { db } from "./db";
import { healthRoute, setDbProbe } from "./http/health";

export { healthRoute };
export { IDENTITY_COOKIE, identityOk, logoutRoute, requireViewer, type Surface, viewerFromCookie, viewerFromRequest } from "./auth/session";
export { oidcCallbackRoute, oidcStartRoute } from "./oidc/routes";
export { authServerRoute, checkAuthorize, metadataPreflight, protectedResourceRoute, registerPreflight, registerRoute, tokenRoute } from "./oauth/routes";
export { dispatch } from "./http/api";
export { mcpResource, publicUrl, safeNext } from "./urls";

// The health probe asks the database a trivial question; opening it (and migrating) is part of answering.
setDbProbe(async () => sql`select 1`.execute(await db()));
