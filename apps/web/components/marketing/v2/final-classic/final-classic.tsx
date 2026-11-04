import { cn } from "@receipt-ocr/ui/lib/utils";
import { SupportWidget } from "@/components/support-widget";
import { Faq, FinalCta, Footer } from "./closing";
import { display } from "./fonts";
import { Header } from "./header";
import { Hero } from "./hero";
import { Pricing } from "./pricing";
import { Trust } from "./trust";
import { How, Output } from "./workflow";
import "./classic.css";

/** Final · Classic: the shipped dark theme and emerald accent, rebuilt around a working demo. */
export function FinalClassic() {
  return (
    <div className={cn("fc min-h-screen bg-background text-foreground", display.variable)}>
      <a
        className="sr-only z-50 rounded-md bg-card px-4 py-3 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
        href="#main"
      >
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Output />
        <How />
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
