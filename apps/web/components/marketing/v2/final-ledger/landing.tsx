import { SupportWidget } from "@/components/support-widget";
import { Footer, Header } from "./chrome";
import { Hero } from "./hero";
import { Faq, FinalCta, Pricing } from "./pricing";
import { Trust } from "./trust";
import { HowItWorks, Workspace } from "./workflow";
import "./ledger.css";

/** Final · Ledger: calm, precise, light. Fonts arrive as CSS variables from the route. */
export function FinalLedger({ fontClassName }: { fontClassName: string }) {
  return (
    <div className={`fl-root min-h-screen overflow-x-clip ${fontClassName}`}>
      <a
        className="sr-only z-50 rounded-md bg-card px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:ring-2 focus:ring-ring"
        href="#main"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Workspace />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <SupportWidget />
    </div>
  );
}
