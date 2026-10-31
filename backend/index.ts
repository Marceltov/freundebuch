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
export { mcpRoute } from "./mcp/mcp";
export { chatEnabled, chatRoute, voiceEnabled, voiceRoute } from "./chat/chat-route";
export { fileRoute, shareRoute, sharingEnabled } from "./sharing/share-route";
export type { ChatContext, ChatLink, ChatTurn } from "./chat/chat";
export { anchorId, conversationPath, itemPath, mcpResource, personPath, publicUrl, safeNext } from "./core/urls";
export { e2eLoginRoute } from "./auth/e2e";

// What the pages read, as the viewer sees it.
export { briefing, type Briefing } from "./reading/briefing";
export { getConversation, hasRecorded, listConversations, type ConversationSummary, type ConversationView } from "./conversations/conversations";
export { whatsDue, type DueItem } from "./reading/due";
export { looks } from "./people/looks";
export { getPerson, peopleOverview, type PersonOverview } from "./people/people";
export { markMatches, search, type SearchHit } from "./reading/search";
export { traitsFor, type PersonTraits, type Traits } from "./people/traits";
export { getGroup, listGroups, type GroupMember, type GroupView } from "./people/groups";
export { daysBetween, today } from "./people/dates";
export { NotFoundError } from "./core/errors";
export { orbit, type Badge, type OrbitFace } from "./people/orbit";
export { calendarRoute, hasCalendarKey } from "./sharing/calendar";
export { cardRoute, ownCards, personCard, type Card, type OwnCard, type PersonCard } from "./sharing/cards";
export { getSettings, userLanguage } from "./core/settings";
export { getReflection } from "./journal/reflection";
export { getRamble, listRambles, type RambleSummary, type RambleView } from "./conversations/rambles";
export { journalEntries, type JournalEntry } from "./journal/journal";
export { getPlace, getSeries, listExperiences, type ExperienceView, type PlaceView, type SeriesView } from "./experiences/experiences";
export { hasShareKey, listPending, pendingCount, type PendingFile } from "./conversations/files";

export type { FactKind, Language, Look, LookPart, LookParts, Viewer } from "./core/types";

// The health probe asks the database a trivial question; opening it (and migrating) is part of answering.
setDbProbe(async () => sql`select 1`.execute(await db()));
