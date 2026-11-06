import { SupportWidget } from "@/components/support-widget";
import { Faq, FinalCta, Footer } from "./closing";
import { Header } from "./header";
import { JsonLd } from "./json-ld";
import { Hero } from "./hero";
import { Pricing } from "./pricing";
import { Trust } from "./trust";
import { How, Output } from "./workflow";
import "./classic.css";

/** Final · Classic: the shipped dark theme and emerald accent, rebuilt around a working demo. */
export function FinalClassic() {
  return (
    <div className="fc min-h-screen bg-background text-foreground">
      <a
        className="sr-only z-50 rounded-md bg-card px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
        href="#main"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <How />
        <Output />
        <Trust />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <SupportWidget />
      <JsonLd />
    </div>
  );
}
