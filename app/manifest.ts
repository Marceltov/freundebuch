import type { MetadataRoute } from "next";
import { copyFor } from "@/components/copy";

export default function manifest(): MetadataRoute.Manifest {
  // One manifest for every visitor, before anyone signs in: in the app's first language.
  const copy = copyFor("de");
  return {
    name: "freundebuch",
    short_name: "freundebuch",
    description: copy.tagline,
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6fb",
    theme_color: "#f4f6fb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    // Android: an installed freundebuch takes shared images. The service worker (public/sw.js) catches the POST and hands the
    // image to /teilen, which sends it on with the cookie.
    share_target: { action: "/teilen/eingang", method: "POST", enctype: "multipart/form-data", params: { files: [{ name: "file", accept: ["image/*", "application/pdf", "text/plain"] }] } },
  };
}
