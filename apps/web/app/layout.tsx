import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const title = "receiptOCR: snap a receipt, get a spreadsheet";
const description =
  "Photograph any receipt. receiptOCR reads the merchant, items, tax and total so you can check it and export a CSV. Free plan, no card required.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: title,
    template: "%s · receiptOCR",
  },
  description,
  applicationName: "receiptOCR",
  keywords: [
    "receipt OCR",
    "receipt scanner",
    "extract receipt data",
    "receipt to CSV",
    "receipts to spreadsheet",
    "expense tracking for freelancers",
    "line item extraction",
  ],
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "receiptOCR",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "receiptOCR",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
