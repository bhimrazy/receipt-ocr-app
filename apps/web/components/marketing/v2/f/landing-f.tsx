import { Bricolage_Grotesque } from "next/font/google";
import { SupportWidget } from "@/components/support-widget";
import { FFaq, FFinalCta, FFooter, FPricing } from "./closing";
import { FHero } from "./hero";
import { FFacts, FHow, FTicker, FTrust } from "./sections";
import "./f.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-f-display",
  display: "swap",
});

export function LandingF() {
  return (
    <div className={`f-root ${display.variable} min-h-screen`}>
      <a
        className="sr-only z-50 rounded-full bg-[var(--f-ink)] px-5 py-3 font-bold text-[var(--f-cream)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        href="#main"
      >
        Skip to content
      </a>
      <FHero />
      <main id="main">
        <FTicker />
        <FHow />
        <FFacts />
        <FTrust />
        <FPricing />
        <FFaq />
        <FFinalCta />
      </main>
      <FFooter />
      <SupportWidget />
    </div>
  );
}
