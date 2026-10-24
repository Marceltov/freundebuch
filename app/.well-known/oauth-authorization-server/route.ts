import { authServerRoute, metadataPreflight } from "@/backend";

// Depends on the request host (without PUBLIC_URL): never prerendered.
export const dynamic = "force-dynamic";

export const GET = authServerRoute;
export const OPTIONS = metadataPreflight;
