import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receipt OCR",
  description: "Extract structured data from receipt images with Gemini OCR.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const body = (
    <html lang="en" suppressHydrationWarning>
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
