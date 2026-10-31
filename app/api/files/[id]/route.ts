import { fileRoute } from "@/backend";

// A shared file, for whoever may see it (backend/sharing/share-route.ts).
export const GET = async (req: Request, { params }: RouteContext<"/api/files/[id]">) => fileRoute(req, (await params).id);
