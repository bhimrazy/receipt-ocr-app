import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { checkoutOpenToEveryone, getCheckoutConfig } from "@/lib/billing";
import { getPlanTable } from "@/lib/plan-limits";
import { homeDescription, homeTitle, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: homeTitle,
  absoluteTitle: true,
  description: homeDescription,
  path: "/",
});

// Prints the plan limits; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default async function Page() {
  const [plans, checkout] = await Promise.all([getPlanTable(), getCheckoutConfig()]);
  return <LandingPage checkoutOpen={checkoutOpenToEveryone(checkout)} plans={plans} />;
}
