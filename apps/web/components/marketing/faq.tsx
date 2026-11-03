import { cn } from "@receipt-ocr/ui/lib/utils";
import { Plus } from "lucide-react";
import { faqs } from "./content";

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.q,
    acceptedAnswer: { "@type": "Answer", text: faq.a },
  })),
};

/** Native <details> keeps it keyboard and screen-reader friendly with no client JS. */
export function FaqList({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <div className={cn("divide-y divide-border rounded-2xl bg-card/40 ring-1 ring-border", className)}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      {faqs.map((faq) => (
        <details className="group [&_summary::-webkit-details-marker]:hidden" key={faq.q}>
          <summary
            className={cn(
              "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mono ? "font-mono text-sm" : "text-[15px]",
            )}
          >
            {mono ? <span><span className="text-primary">Q.</span> {faq.q}</span> : faq.q}
            <Plus
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45 group-open:text-primary"
            />
          </summary>
          <p className="max-w-2xl px-5 pb-5 text-sm leading-7 text-muted-foreground">{faq.a}</p>
        </details>
      ))}
    </div>
  );
}
