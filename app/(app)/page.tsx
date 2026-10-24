import { headers } from "next/headers";
import { mcpResource, orbit } from "@/backend";
import { copy } from "@/components/copy";
import { CopyField } from "@/components/CopyButton";
import { Orbit } from "@/components/Orbit";
import { pageViewer } from "./viewer";

export const dynamic = "force-dynamic";

// The start page: the viewer's orbit; before anything is recorded, how to connect Claude.
export default async function OrbitPage() {
  const v = await pageViewer();
  const faces = await orbit(v);
  if (faces.length) return <Orbit faces={faces} />;
  return (
    <div className="mt-8 rounded-2xl bg-surface p-5 shadow-card">
      <p>{copy.orbitEmpty}</p>
      <p className="mt-4 mb-1.5 text-xs font-bold tracking-wide text-muted uppercase">{copy.mcpUrl}</p>
      <CopyField label={copy.mcpUrl} text={mcpResource(await headers())} />
    </div>
  );
}
