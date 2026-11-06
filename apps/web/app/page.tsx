import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { canonicalFor, siteTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: siteTitle },
  alternates: canonicalFor("/"),
};

export default function Page() {
  return <LandingPage />;
}
