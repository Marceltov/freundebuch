import type { Metadata, Viewport } from "next";
import "./globals.css";
import { copy } from "@/components/copy";

export const metadata: Metadata = {
  title: { default: "freundebuch", template: "%s · freundebuch" },
  description: copy.tagline,
};

// `viewportFit: "cover"`: phone first, the page reaches into the screen's rounded corners.
export const viewport: Viewport = { viewportFit: "cover", themeColor: [{ color: "#f2f3f0", media: "(prefers-color-scheme: light)" }, { color: "#15161b", media: "(prefers-color-scheme: dark)" }] };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="antialiased">
      <body className="font-sans text-base leading-relaxed">{children}</body>
    </html>
  );
}
