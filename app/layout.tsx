import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";
import "./globals.css";
import { copy } from "@/components/copy";

export const metadata: Metadata = {
  title: { default: "freundebuch", template: "%s · freundebuch" },
  description: copy.tagline,
};

// `viewportFit: "cover"`: phone first, the page reaches into the screen's rounded corners.
export const viewport: Viewport = { viewportFit: "cover", themeColor: [{ color: "#f4f6fb", media: "(prefers-color-scheme: light)" }, { color: "#1b1726", media: "(prefers-color-scheme: dark)" }] };

// Fraunces for names and headings, Atkinson Hyperlegible for everything read in between; both served from the app itself.
const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-fraunces", display: "swap" });
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-text", display: "swap" });

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className={`${fraunces.variable} ${text.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">{children}</body>
    </html>
  );
}
