import { cn } from "@receipt-ocr/ui/lib/utils";
import { SupportWidget } from "@/components/support-widget";
import { FaqPaper, FinalCtaPaper, FooterPaper } from "./closing";
import { display, mono, sans } from "./fonts";
import { HeaderPaper } from "./header";
import { HeroPaper } from "./hero";
import { HowPaper } from "./how";
import { LedgerPaper } from "./ledger";
import { PricingPaper } from "./pricing";
import { TrustPaper } from "./trust";
import "./paper.css";

export function FinalPaper() {
  return (
    <div className={cn("paper-pp min-h-screen", display.variable, sans.variable, mono.variable)}>
      <a
        className="sr-only z-50 rounded-md bg-foreground px-4 py-3 text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        href="#main"
      >
        Skip to content
      </a>
      <HeaderPaper />
      <main id="main">
        <HeroPaper />
        <LedgerPaper />
        <HowPaper />
        <TrustPaper />
        <PricingPaper />
        <FaqPaper />
        <FinalCtaPaper />
      </main>
      <FooterPaper />
      {/* Inside the wrapper so it picks up the paper theme tokens. */}
      <SupportWidget />
    </div>
  );
}
