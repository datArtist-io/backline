import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Hanken_Grotesk, Unbounded } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";

const display = Unbounded({ subsets: ["latin"], variable: "--font-display", weight: ["300", "400", "500"] });
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  openGraph: { title: BRAND.name, description: BRAND.description, siteName: BRAND.name, type: "website" },
  twitter: { card: "summary_large_image", title: BRAND.name, description: BRAND.description },
};

export const viewport: Viewport = {
  themeColor: "#eef1f8",
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("bl.theme");if(t!=="dark"&&t!=="light")t="dark";document.documentElement.setAttribute("data-bl-theme",t)}catch(e){document.documentElement.setAttribute("data-bl-theme","dark")}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions add attributes to <html>/<body> before React loads.
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        {/* The theme before the first paint: the one they picked, else dark for everyone. Without it the page
            showed in light for the seconds it took the scripts to load. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
