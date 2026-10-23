import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "freundebuch",
    short_name: "freundebuch",
    description: "Wer ist dir wichtig, und was ist gerade los bei ihnen.",
    lang: "de",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f3f0",
    theme_color: "#f2f3f0",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
