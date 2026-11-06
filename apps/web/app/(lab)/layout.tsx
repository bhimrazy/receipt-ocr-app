import type { Metadata } from "next";

// Temporary design directions for the owner to compare; never indexed, removed once one is chosen.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
