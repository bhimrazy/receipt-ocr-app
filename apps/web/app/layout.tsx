import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ConsentManager } from "@/components/consent/consent-manager";
import { Pwa } from "@/components/pwa";
import { ThemeProvider } from "@/components/theme-provider";
import { gaMeasurementId } from "@/lib/consent/env";
import { DISPLAY_MODE_SCRIPT } from "@/lib/display-mode";
import { startupImages } from "@/lib/ios-splash";
import { buildIsIndexable } from "@/lib/seo-hosts";
import { homeDescription, homeTitle } from "@/lib/seo";
import { SITE_NAME, siteUrl } from "@/lib/site";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";
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
  // "default", not "black-translucent": pages start below the status bar, so no layout needs a
  // top safe-area inset. "default" lets the bar follow the page's theme rather than staying black.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SITE_NAME,
    startupImage: startupImages,
  },
};

// No maximumScale or userScalable: pinch zoom stays available (WCAG 1.4.4).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Per OS scheme, for System. THEME_SCRIPT prepends one unconditional colour for an explicit choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
  colorScheme: "dark light",
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
      <head>
        {/* A plain blocking script, not next/script: it must run while parsing, before paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_MODE_SCRIPT }} />
        {/* Next emits only mobile-web-app-capable; iOS has needed the Apple name for startup images. */}
        <meta content="yes" name="apple-mobile-web-app-capable" />
      </head>
      {/* viewport-fit=cover lets pages run under a landscape notch; keep content beside it. */}
      <body className="pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] font-sans antialiased">
        {children}
        <ThemeProvider />
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
