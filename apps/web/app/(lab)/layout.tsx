import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Temporary design directions for the owner to compare; never indexed, removed once one is chosen.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// The pages are prerendered, so LAB_PAGES is read at build time: set it for the build that should show them.
const labVisible = process.env.NODE_ENV === "development" || process.env.LAB_PAGES === "1";

export default function LabLayout({ children }: { children: React.ReactNode }) {
  if (!labVisible) notFound();
  return children;
}
