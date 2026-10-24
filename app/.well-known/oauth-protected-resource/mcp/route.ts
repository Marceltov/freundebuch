import { metadataPreflight, protectedResourceRoute } from "@/backend";

// Depends on the request host (without PUBLIC_URL): never prerendered.
export const dynamic = "force-dynamic";

export const GET = protectedResourceRoute;
export const OPTIONS = metadataPreflight;
