import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CreditCard, Link2Off } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthMessage } from "@/components/auth/auth-field";
import { PayCheckout } from "@/components/billing/pay-checkout";
import { SlimHeader } from "@/components/legal-page";
import { SiteFooter } from "@/components/site-footer";
import { SupportWidget } from "@/components/support-widget";
import { getCheckoutFor } from "@/lib/billing";
import { logPageRender } from "@/lib/page-event";
import { parsePaymentLink } from "@/lib/payment-link";
import { pageMetadata } from "@/lib/seo";
import { getSession, isAdmin } from "@/lib/session";

export const metadata: Metadata = pageMetadata({
  title: "Payment",
  description: "Opens Paddle's checkout for a ReceiptOCR payment link.",
  path: "/pay",
  index: false,
});

/**
 * The Paddle account's default payment link. Paddle appends `?_ptxn=txn_…` to it for a
 * transaction's checkout link and for the update-payment-method links in its emails, and expects
 * this page to open Paddle.js's checkout for that transaction
 * (https://developer.paddle.com/build/transactions/default-payment-link).
 *
 * No sign-in and no lookup: the id is only shape-checked and handed to Paddle.js, which shows
 * the transaction to whoever holds the link, as Paddle's own hosted links do. Paddle.js and the
 * client token reach the browser only with a well-formed id and a checkout this viewer may use
 * (`getCheckoutFor`): sandbox keys on the live site stay with platform admins, or anyone could
 * take the sandbox token and buy Pro there with a test card.
 */
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ _ptxn?: string | string[] }>;
}) {
  logPageRender("/pay");
  const link = parsePaymentLink((await searchParams)._ptxn);
  const checkout =
    link.kind === "transaction" ? await getCheckoutFor(isAdmin(await getSession())) : null;

  let content: React.ReactNode;
  if (link.kind === "transaction" && checkout) {
    const { environment, clientToken } = checkout.config;
    content = (
      <PayCheckout
        settings={{ environment, clientToken }}
        testMode={checkout.testMode}
        transactionId={link.transactionId}
      />
    );
  } else if (link.kind === "transaction") {
    content = (
      <AuthMessage actions={<PricingLink />} icon={CreditCard} title="Payments aren't open yet">
        <p>
          This payment link can&apos;t be used here yet. See pricing for what Pro includes, or use
          the support button if you were expecting to pay.
        </p>
      </AuthMessage>
    );
  } else if (link.kind === "invalid") {
    content = (
      <AuthMessage
        actions={<PricingLink />}
        icon={Link2Off}
        title="This payment link isn't complete"
        tone="warning"
      >
        <p>
          Open it again from the email Paddle sent you, or copy the whole link. If it still
          doesn&apos;t work, use the support button and tell us the email address you pay with.
        </p>
      </AuthMessage>
    );
  } else {
    content = (
      <AuthMessage actions={<PricingLink />} icon={CreditCard} title="Payments for ReceiptOCR">
        <p>
          Payment links from Paddle, our reseller, open their checkout on this page. There&apos;s
          nothing to pay here right now.
        </p>
      </AuthMessage>
    );
  }

  return (
    <>
      <SlimHeader />
      <main className="grid min-h-[calc(100vh-12rem)] place-items-center bg-background px-5 py-16 text-foreground">
        <div className="w-full max-w-md">{content}</div>
      </main>
      <SiteFooter narrow />
      <SupportWidget />
    </>
  );
}

function PricingLink() {
  return (
    <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")} href="/pricing">
      See plans and pricing
    </Link>
  );
}
