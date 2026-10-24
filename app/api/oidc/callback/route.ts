import { oidcCallbackRoute } from "@/backend";

// authentik sends the browser back here (the redirect URI registered with it).
export const GET = oidcCallbackRoute;
