import { fileRoute } from "@/backend";

// A shared screenshot's image, for whoever may see it (backend/share-route.ts).
export const GET = async (req: Request, { params }: RouteContext<"/api/files/[id]">) => fileRoute(req, (await params).id);
