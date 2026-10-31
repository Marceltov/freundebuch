import { cardRoute } from "@/backend";

// An own card (backend/cards.ts): /api/card/{key}.vcf, read by another freundebuch or any contacts app without a sign-in.
export async function GET(_req: Request, { params }: RouteContext<"/api/card/[file]">) {
  return cardRoute((await params).file);
}
