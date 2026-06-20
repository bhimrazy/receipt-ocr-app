import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How receiptOCR handles your receipts and data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="June 2026"
      intro="We keep this simple: your receipts and the data we extract from them are yours. This policy explains what we collect, why, and the controls you have."
      sections={[
        {
          heading: "What we collect",
          body: [
            "Account details from your sign-in provider (name and email) to identify your account.",
            "The receipt images you upload and the structured data extracted from them — merchant, dates, line items, tax, and totals.",
          ],
        },
        {
          heading: "Where your data lives",
          body: [
            "Receipt images are stored in S3-compatible object storage (Cloudflare R2, AWS S3, or self-hosted MinIO). When you bring your own storage keys, that storage is yours to control.",
            "Storage and provider keys stay server-side and are never exposed to the browser.",
          ],
        },
        {
          heading: "How we use it",
          body: [
            "To run OCR on your receipts, store your history, and let you search and export your data. We do not sell your data or use your receipts to train third-party models.",
          ],
        },
        {
          heading: "Your controls",
          body: [
            "You can export your data to JSON or CSV at any time, and request deletion of your receipts and account by contacting us.",
          ],
        },
      ]}
    />
  );
}
