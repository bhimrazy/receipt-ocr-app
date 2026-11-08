import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { getPlanTable } from "@/lib/plan-limits";
import { homeDescription, pageMetadata } from "@/lib/seo";
import { siteTitle } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: siteTitle,
  absoluteTitle: true,
  description: homeDescription,
  path: "/",
});

// Prints the plan limits; an admin save also revalidates (revalidatePlanCopy).
export const revalidate = 3600;

export default async function Page() {
  return <LandingPage plans={await getPlanTable()} />;
}
