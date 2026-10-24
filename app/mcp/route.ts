import { mcpRoute } from "@/backend";

// MCP over Streamable HTTP is POST only; there is no server-sent stream or session to GET or DELETE.
export const POST = (req: Request) => mcpRoute(req);
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
