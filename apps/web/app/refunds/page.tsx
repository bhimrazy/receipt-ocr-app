import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { REFUND_DAYS } from "@/lib/pricing";
import { formatLegalDate, LEGAL_UPDATED, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Refund policy",
  description: `ReceiptOCR refunds: in full within ${REFUND_DAYS} days of a subscription's first payment. Cancel any time and keep Pro until the period ends.`,
  path: "/refunds",
});

export default function RefundsPage() {
  return (
    <LegalPage
      title="Refund policy"
      updated={formatLegalDate(LEGAL_UPDATED.refunds)}
      intro="This policy covers payments for ReceiptOCR Pro. Paddle.com is our reseller and the merchant of record for every order, so Paddle processes refunds and sends any money back to the card or account you paid with."
      sections={[
        {
          heading: `${REFUND_DAYS} days on your first payment`,
          body: [
            `If Pro isn't right for you, ask for a refund within ${REFUND_DAYS} days of a subscription's first payment and you'll get the full amount back, whether you paid monthly or yearly. The workspace goes back to the Free plan when the refund is made.`,
            "Later renewals aren't refunded, except where the law gives you a right to one or something went wrong on our side, such as being charged twice or the service being unavailable for a long time.",
          ],
        },
        {
          heading: "Cancel any time",
          body: [
            "You can cancel a subscription at any time from Settings, Plan and billing, in the workspace it pays for. Nothing more is charged after that. Pro stays on until the end of the period you've already paid for, then the workspace moves to the Free plan. Your receipts stay where they are.",
          ],
        },
        {
          heading: "Scan packs",
          body: [
            `If we sell scan packs, an unused pack can be refunded within ${REFUND_DAYS} days of buying it. Once any scan in a pack is used, it can't be refunded. Scan packs aren't on sale yet.`,
          ],
        },
        {
          heading: "Your legal rights",
          body: [
            "Nothing in this policy takes away rights you have under the law where you live. Paddle's buyer terms also apply to your purchase and explain those rights, including the right to withdraw for consumers in the UK, the EU and the EEA.",
          ],
          links: [
            {
              label: "Paddle buyer terms",
              href: "https://www.paddle.com/legal/checkout-buyer-terms",
            },
          ],
        },
        {
          heading: "How to ask for a refund",
          body: [
            "Reply to the receipt email Paddle sent you, or find your order at paddle.net and ask for a refund there. You can also use the support button at the bottom right of this page; tell us the email address you paid with.",
          ],
        },
      ]}
    />
  );
}
