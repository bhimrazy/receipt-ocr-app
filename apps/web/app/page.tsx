import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { siteTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: siteTitle },
  alternates: { canonical: "/" },
};

export default function Page() {
  return <LandingPage />;
}
