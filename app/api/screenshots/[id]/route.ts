import { screenshotRoute } from "@/backend";

// A shared screenshot's image, for whoever may see it (backend/share-route.ts).
export const GET = async (req: Request, { params }: RouteContext<"/api/screenshots/[id]">) => screenshotRoute(req, (await params).id);
