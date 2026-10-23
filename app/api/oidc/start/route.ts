import { oidcStartRoute } from "@/backend";

// GET: the login page's link (?next=). POST: the MCP authorize page's form, same-origin only.
export const GET = oidcStartRoute;
export const POST = oidcStartRoute;
