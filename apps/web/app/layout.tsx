import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
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
const title = "receiptOCR — Turn receipts into structured data";
const description =
  "Snap or upload any receipt and get clean, structured data — merchant, line items, tax, and totals — each with a confidence score, ready to search, review, and export. Free to start, bring your own keys when you scale.";

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
    "receipt to JSON",
    "expense tracking",
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const body = (
    <html
      lang="en"
      className={`${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );

  if (!clerkPublishableKey) {
    return body;
  }

  return (
    <ClerkProvider afterSignOutUrl="/" publishableKey={clerkPublishableKey}>
      {body}
    </ClerkProvider>
  );
}
