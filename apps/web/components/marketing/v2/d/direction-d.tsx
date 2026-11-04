import { cn } from "@receipt-ocr/ui/lib/utils";
import { FaqD, FinalCtaD, FooterD } from "./closing";
import { display, mono, sans } from "./fonts";
import { HeaderD } from "./header";
import { HeroD } from "./hero";
import { HowD } from "./how";
import { LedgerD } from "./ledger";
import { PricingD } from "./pricing";
import { DataNoteD, FinePrintD } from "./trust";
import "./d.css";

export function DirectionD() {
  return (
    <div className={cn("paper-d min-h-screen", display.variable, sans.variable, mono.variable)}>
      <a
        className="sr-only z-50 rounded-md bg-foreground px-4 py-3 text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main"
      >
        Skip to content
      </a>
      <HeaderD />
      <main id="main">
        <HeroD />
        <LedgerD />
        <HowD />
        <DataNoteD />
        <FinePrintD />
        <PricingD />
        <FaqD />
        <FinalCtaD />
      </main>
      <FooterD />
    </div>
  );
}
