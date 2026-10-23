import type { MetadataRoute } from "next";
import { copy } from "@/components/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "freundebuch",
    short_name: "freundebuch",
    description: copy.tagline,
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f3f0",
    theme_color: "#f2f3f0",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
