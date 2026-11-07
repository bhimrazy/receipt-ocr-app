import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getPlanTable } from "@/lib/plan-limits";
import { formatLegalDate, LEGAL_UPDATED, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms of service",
  description:
    "The terms for using ReceiptOCR: your account, your receipts, the free plan, and checking AI-extracted data before you rely on it.",
  path: "/terms",
});

// Shows the free plan's limits; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default async function TermsPage() {
  const { free } = await getPlanTable();
  const workspaces = free.workspaces === 1 ? "1 workspace" : `${free.workspaces} workspaces`;
  return (
    <LegalPage
      title="Terms of service"
      updated={formatLegalDate(LEGAL_UPDATED.terms)}
      intro="These terms apply when you use ReceiptOCR. By creating an account or using the service, you agree to them. ReceiptOCR is in early access, so some features may change."
      sections={[
        {
          heading: "The service",
          body: [
            "ReceiptOCR scans receipt images you upload and extracts data such as merchant, date, line items, tax and total, which you can review, edit and export.",
            "Receipts are scanned by AI models from Google (Gemini) and Anthropic (Claude), and from Groq or OpenAI when one is turned on. We choose the models and may change them. AI can misread or miss information, so check the extracted data before you rely on it for accounting, tax or anything else. The confidence score is a guide, not a guarantee.",
          ],
        },
        {
          heading: "Your account",
          body: [
            "Give accurate details when you sign up and keep your password secure. You're responsible for activity in your account and in workspaces you own.",
            "When you invite people to a workspace, they can see and change the receipts in it.",
          ],
        },
        {
          heading: "Your content",
          body: [
            "You keep ownership of the receipts you upload and the data extracted from them.",
            "You give us permission to store, process and display that content, and to send it to the processors listed in our Privacy policy, only as needed to provide the service to you.",
            "Upload only receipts you have the right to share. Don't upload content that is unlawful or that contains other people's personal information without a lawful reason.",
          ],
        },
        {
          heading: "Plans and limits",
          body: [
            `The free plan currently includes up to ${free.receiptsPerDay} receipts a day and ${workspaces}, with no card required. We may change these limits, and we'll update the site when we do.`,
            "Paid plans aren't available yet. If we introduce them, we'll show the price and what it includes before you're asked to pay anything.",
          ],
        },
        {
          heading: "Acceptable use",
          body: [
            "Don't try to get around usage limits, disrupt or overload the service, access other people's data, or use the service to build a competing product by copying it.",
            "We may suspend accounts that break these terms or put the service or other users at risk.",
          ],
        },
        {
          heading: "Early access and availability",
          body: [
            "The service is provided as it is and as available. We work to keep it running and accurate, but we don't promise it will be uninterrupted, error-free or that extraction will be correct.",
            "Export anything you need to keep. We may change or stop features during early access.",
          ],
        },
        {
          heading: "Ending your use",
          body: [
            "You can stop using ReceiptOCR and delete your account from Settings at any time. Our Privacy policy explains what deletion removes.",
          ],
        },
        {
          heading: "Changes to these terms",
          body: [
            "If we change these terms, we'll update the date at the top of this page. For significant changes, we'll tell you by email before they take effect.",
          ],
        },
        {
          heading: "Contact",
          body: [
            "Questions about these terms? Use the support button at the bottom right of this page.",
          ],
        },
      ]}
    />
  );
}
