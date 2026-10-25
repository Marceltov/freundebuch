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
export { mcpRoute } from "./mcp";
export { chatEnabled, chatRoute } from "./chat-route";
export type { ChatContext, ChatLink, ChatTurn } from "./chat";
export { anchorId, itemPath, mcpResource, personPath, publicUrl, safeNext } from "./urls";
export { e2eLoginRoute } from "./auth/e2e";

// What the pages read, as the viewer sees it.
export { briefing, type Briefing } from "./briefing";
export { getConversation, listConversations, type ConversationSummary, type ConversationView } from "./conversations";
export { whatsDue, type DueItem } from "./due";
export { getPerson, peopleOverview, type PersonOverview } from "./people";
export { getGroup, listGroups, type GroupMember, type GroupView } from "./groups";
export { daysBetween, today } from "./dates";
export { NotFoundError } from "./errors";
export { orbit, type Badge, type OrbitFace } from "./orbit";
export { getSettings } from "./settings";
export type { Viewer } from "./types";

// The health probe asks the database a trivial question; opening it (and migrating) is part of answering.
setDbProbe(async () => sql`select 1`.execute(await db()));
