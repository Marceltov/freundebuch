import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/i18n";
import { requestLanguage, siteCopy } from "./language";

export const generateMetadata = async (): Promise<Metadata> => ({
  title: { default: "freundebuch", template: "%s · freundebuch" },
  description: (await siteCopy()).tagline,
});

// `viewportFit: "cover"`: phone first, the page reaches into the screen's rounded corners. `interactiveWidget`: the on-screen
// keyboard shrinks the page instead of sliding it up, so the chat sheet stays above it with its messages in view.
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { color: "#f4f6fb", media: "(prefers-color-scheme: light)" },
    { color: "#1b1726", media: "(prefers-color-scheme: dark)" },
  ],
};

// Fraunces for names and headings, Atkinson Hyperlegible for everything read in between; both served from the app itself.
const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-fraunces", display: "swap" });
const text = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-text", display: "swap" });

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const language = await requestLanguage();
  return (
    <html lang={language} className={`${fraunces.variable} ${text.variable} antialiased`}>
      <body className="font-sans text-base leading-relaxed">
        <LanguageProvider language={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
