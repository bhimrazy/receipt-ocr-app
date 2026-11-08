import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PricingPlans } from "@/components/billing/pricing-plans";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SupportWidget } from "@/components/support-widget";
import { checkoutOpenToEveryone, getCheckoutConfig } from "@/lib/billing";
import { getPlanTable } from "@/lib/plan-limits";
import { allowance } from "@/lib/plan-copy";
import { PRO_PRICE_LABEL, REFUND_DAYS } from "@/lib/pricing";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description: `ReceiptOCR pricing: Free to start, Pro at ${PRO_PRICE_LABEL.month} a month or ${PRO_PRICE_LABEL.year} a year per workspace. Cancel any time; taxes handled by Paddle.`,
  path: "/pricing",
});

// Prints the plan limits; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

const links = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default async function PricingPage() {
  const [plans, checkout] = await Promise.all([getPlanTable(), getCheckoutConfig()]);
  const { free, pro } = plans;
  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "Plans are per workspace. What does that mean?",
      a: (
        <>
          A Pro subscription covers exactly one workspace.
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              That workspace&apos;s {allowance(pro)} are shared by everyone in it, and scanning
              there never uses anyone&apos;s Free scans.
            </li>
            <li>Your other workspaces, and new ones, stay on Free until each is upgraded.</li>
            <li>
              Free scans ({allowance(free)}) are per person, counted across every Free workspace you
              use.
            </li>
            <li>
              You can own {free.workspaces === 1 ? "1 workspace" : `${free.workspaces} workspaces`}{" "}
              on Free, and {pro.workspaces} once one of them is on Pro.
            </li>
          </ul>
        </>
      ),
    },
    {
      q: "Can I cancel any time?",
      a: "Yes. Cancel from Settings, Billing. Nothing more is charged, and Pro stays on until the end of the period you've paid for. Then the workspace moves to Free and keeps all its receipts.",
    },
    {
      q: "Can I get a refund?",
      a: (
        <>
          Yes, within {REFUND_DAYS} days of a subscription&apos;s first payment, in full. Later
          renewals aren&apos;t refunded unless the law gives you that right. See the{" "}
          <Link className="text-foreground underline underline-offset-4" href="/refunds">
            refund policy
          </Link>
          .
        </>
      ),
    },
    {
      q: "Who handles payment and taxes?",
      a: "Paddle.com is our reseller and the merchant of record. It runs the checkout, charges sales tax or VAT for your country, sends your receipts and invoices, and handles refunds. We never see your card details.",
    },
    {
      q: "What counts as a scan?",
      a: "Each receipt read successfully, and each one still being read. A few failed reads don't count, so a blurry photo doesn't use up your allowance.",
    },
    {
      q: "What happens when I reach a limit?",
      a: `Uploads pause until the limit resets: daily limits at 00:00 UTC, monthly limits on the 1st of each month at 00:00 UTC. Unused scans don't carry over. Free accounts also share a daily scanning capacity, and on a very busy day Free scanning may pause until 00:00 UTC. Pro workspaces aren't affected by that.`,
    },
  ];

  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <SiteHeader links={links} />
      <main>
        <section className="px-5 pb-20 pt-36 md:pt-40">
          <div className="mx-auto max-w-5xl">
            <div className="mx-auto mb-10 max-w-2xl text-center">
              <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">Pricing</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
                Start free. Upgrade a workspace when it needs more.
              </h1>
              <p className="mt-4 text-pretty text-muted-foreground">
                Pro is {PRO_PRICE_LABEL.month} a month or {PRO_PRICE_LABEL.year} a year for one
                workspace, plus sales tax or VAT where it applies. Cancel any time.
              </p>
            </div>
            <PricingPlans checkoutOpen={checkoutOpenToEveryone(checkout)} plans={plans} />
          </div>
        </section>

        <section
          aria-labelledby="pricing-faq"
          className="border-t border-border px-5 py-20 md:py-24"
        >
          <div className="mx-auto max-w-3xl">
            <h2
              className="mb-8 text-center text-2xl font-bold tracking-tight md:text-3xl"
              id="pricing-faq"
            >
              Pricing questions
            </h2>
            {/* Native disclosure: no client JS, and every answer is in the HTML. */}
            <div className="flex w-full flex-col divide-y divide-border rounded-xl border border-border">
              {faqs.map((faq) => (
                <details className="group/faq px-5" key={faq.q}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {faq.q}
                    <Plus
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open/faq:rotate-45 group-open/faq:text-primary"
                    />
                  </summary>
                  <div className="pb-5 text-sm leading-7 text-muted-foreground">{faq.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
      <SupportWidget />
    </div>
  );
}
