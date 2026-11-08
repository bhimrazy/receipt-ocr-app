import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ConsentManager } from "@/components/consent/consent-manager";
import { Pwa } from "@/components/pwa";
import { gaMeasurementId } from "@/lib/consent/env";
import { startupImages } from "@/lib/ios-splash";
import { buildIsIndexable } from "@/lib/seo-hosts";
import { homeDescription, homeTitle } from "@/lib/seo";
import { SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

// The opsz axis gives large headings the tighter display cut; one font load serves both.
const dmSans = DM_Sans({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: homeTitle,
    template: `%s · ${SITE_NAME}`,
  },
  description: homeDescription,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: homeTitle,
    description: homeDescription,
  },
  twitter: {
    card: "summary_large_image",
    title: homeTitle,
    description: homeDescription,
  },
  // Preview builds carry noindex in the HTML too. Per-host X-Robots-Tag rules are in next.config.ts.
  robots: buildIsIndexable(process.env)
    ? { index: true, follow: true }
    : { index: false, follow: false },
  // "black", not "black-translucent": pages start below the status bar, so no layout needs a
  // top safe-area inset. The bar matches --background closely enough to read as one surface.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: SITE_NAME,
    startupImage: startupImages,
  },
};

// No maximumScale or userScalable: pinch zoom stays available (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0b",
  colorScheme: "dark",
  // Draw under the notch and home indicator; the shell pads itself with env(safe-area-inset-*).
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      {/* viewport-fit=cover lets pages run under a landscape notch; keep content beside it. */}
      <body className="pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] font-sans antialiased">
        {children}
        <Pwa />
        {/* VERCEL is set in Vercel builds only; Docker images run no page counts. */}
        <ConsentManager
          gaMeasurementId={gaMeasurementId}
          vercelAnalytics={process.env.VERCEL === "1"}
        />
      </body>
    </html>
  );
}
