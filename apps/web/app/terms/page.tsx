import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { getPlanTable } from "@/lib/plan-limits";
import { allowance } from "@/lib/plan-copy";
import { PRO_PRICE_LABEL } from "@/lib/pricing";
import { authorName } from "@/lib/site";
import { formatLegalDate, LEGAL_UPDATED, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms of service",
  description:
    "The terms for ReceiptOCR: your account and receipts, the Free and Pro plans, payments through Paddle, and checking AI-extracted data before relying on it.",
  path: "/terms",
});

// Shows the free plan's limits; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default async function TermsPage() {
  const { free, pro } = await getPlanTable();
  const owned = (n: number) => (n === 1 ? "1 workspace" : `${n} workspaces`);
  const workspaces = owned(free.workspaces);
  return (
    <LegalPage
      title="Terms of service"
      updated={formatLegalDate(LEGAL_UPDATED.terms)}
      intro={`These terms apply when you use ReceiptOCR, a service run by ${authorName}. By creating an account or using the service, you agree to them. ReceiptOCR is in early access, so some features may change.`}
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
            `The free plan currently includes ${allowance(free)} per person, counted across every workspace they use, up to ${free.membersPerWorkspace} members in a workspace, and ${workspaces} to own, with no card required.`,
            `Pro is a subscription for one workspace, at ${PRO_PRICE_LABEL.month} a month or ${PRO_PRICE_LABEL.year} a year, plus any sales tax or VAT. It currently includes ${allowance(pro)} for that workspace, shared by its members, up to ${pro.membersPerWorkspace} members, and lets its owner own up to ${owned(pro.workspaces)}. Each workspace needs its own subscription to be on Pro.`,
            "Daily limits reset at 00:00 UTC and monthly limits on the 1st of each month at 00:00 UTC. Unused scans don't carry over.",
            "We may change these limits or prices. A price change applies from your next billing period, and we'll tell you by email before it does.",
          ],
        },
        {
          heading: "Payments",
          body: [
            "Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns.",
            "When you buy Pro, you buy it from Paddle under Paddle's buyer terms, which apply alongside these terms. Paddle charges your payment method, adds sales tax or VAT where it applies, and sends your receipts and invoices.",
            "A subscription renews automatically at the end of each billing period until you cancel it. You can cancel any time from Settings, Billing; Pro stays on until the end of the period you've paid for. Refunds follow our refund policy.",
          ],
          links: [
            { label: "Refund policy", href: "/refunds" },
            {
              label: "Paddle buyer terms",
              href: "https://www.paddle.com/legal/checkout-buyer-terms",
            },
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
