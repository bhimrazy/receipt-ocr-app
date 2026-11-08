import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { homeDescription, homeTitle, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: homeTitle,
  absoluteTitle: true,
  description: homeDescription,
  path: "/",
});

export default function Page() {
  return <LandingPage />;
}
