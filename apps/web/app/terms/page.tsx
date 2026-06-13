import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using receiptOCR.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="June 2026"
      intro="By using receiptOCR you agree to these terms. They cover what you can expect from us and what we expect from you while the product is in early access."
      sections={[
        {
          heading: "Using the service",
          body: [
            "receiptOCR extracts structured data from receipt images you upload. You're responsible for having the right to upload and process the receipts you submit.",
          ],
        },
        {
          heading: "Free tier and your own keys",
          body: [
            "The free tier is offered as-is with usage limits. When you bring your own AI and storage keys, you pay those providers directly and are bound by their terms in addition to ours.",
          ],
        },
        {
          heading: "Early access",
          body: [
            "The product is under active development. Features may change, and we provide the service without warranties of uninterrupted or error-free operation.",
          ],
        },
        {
          heading: "Your data",
          body: [
            "You retain ownership of your receipts and extracted data. You can export or request deletion at any time, as described in our Privacy Policy.",
          ],
        },
      ]}
    />
  );
}
