import { dispatch } from "@/backend";

// The REST API: every /api/v1 route is an entry in backend/http/api.ts, which also generates the
// OpenAPI description. Every method goes to the dispatcher, so a wrong one gets the API's JSON 405
// rather than Next's empty one.
const handle = async (req: Request, { params }: RouteContext<"/api/v1/[...path]">) => dispatch(req, (await params).path);

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
