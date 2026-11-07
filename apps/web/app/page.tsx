import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { homeDescription, pageMetadata } from "@/lib/seo";
import { siteTitle } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: siteTitle,
  absoluteTitle: true,
  description: homeDescription,
  path: "/",
});

export default function Page() {
  return <LandingPage />;
}
