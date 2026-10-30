import Link from "next/link";
import { Fragment } from "react";
import { MapPin } from "lucide-react";
import type { PlaceView } from "@/backend";
import { getCopy } from "@/components/serverCopy";
import { Section } from "@/components/Tiles";

type Facts = Pick<PlaceView, "parents" | "address" | "owners" | "inside">;

// What a place is besides what happened there: where it sits, its address, whose home it is, and the places inside it.
export function PlaceFacts({ p }: { p: Facts }) {
  const copy = getCopy();
  const links = (xs: Facts["owners"]) =>
    xs.map((x, i) => (
      <Fragment key={x.id}>
        {i > 0 && " · "}
        <Link href={x.url} className="font-semibold text-carbon">
          {x.name}
        </Link>
      </Fragment>
    ));
  if (!p.parents.length && !p.address && !p.owners.length && !p.inside.length) return null;
  return (
    <>
      {p.parents.length > 0 && (
        <p className="mt-1 text-muted">
          {copy.placeIn} {links(p.parents)}
        </p>
      )}
      {p.address && (
        <p className="mt-1 text-muted">
          <span className="sr-only">{copy.placeAddress}: </span>
          {p.address}
        </p>
      )}
      {p.owners.length > 0 && (
        <p className="mt-1 text-muted">
          {copy.placeOwners} {links(p.owners)}
        </p>
      )}
      {p.inside.length > 0 && (
        <Section title={copy.placeInside} icon={MapPin} list>
          {p.inside.map((x) => (
            <li key={x.id} className="py-1">
              <Link href={x.url} className="font-semibold text-carbon">
                {x.name}
              </Link>
            </li>
          ))}
        </Section>
      )}
    </>
  );
}
