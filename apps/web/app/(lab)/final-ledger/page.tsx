import { Caveat, IBM_Plex_Mono, Schibsted_Grotesk } from "next/font/google";
import { FinalLedger } from "@/components/marketing/v2/final-ledger/landing";

const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-fl-sans", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-fl-mono",
  display: "swap",
});
// Only the red-pencil margin note and handwritten tips use it.
const hand = Caveat({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-fl-hand",
  display: "swap",
});

export const metadata = { title: "Final · Ledger" };

export default function Page() {
  return <FinalLedger fontClassName={`${sans.variable} ${mono.variable} ${hand.variable}`} />;
}
