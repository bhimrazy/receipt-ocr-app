import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export type LegalSection = { heading: string; body: string[] };

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-5 py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" aria-label="receiptOCR home">
            <Brand />
          </Link>
          <Link
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="/"
          >
            <ArrowLeft className="size-4" /> Back to home
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">Legal</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-3 font-mono text-xs text-muted-foreground">Last updated {updated}</p>
        <p className="mt-6 text-pretty leading-7 text-muted-foreground">{intro}</p>

        <div className="mt-10 flex flex-col gap-8">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p className="mt-3 leading-7 text-muted-foreground" key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-12 rounded-xl border border-border bg-secondary/30 p-5 text-sm leading-7 text-muted-foreground">
          This is template legal copy for an early-access product and is not legal advice. Replace
          it with reviewed terms before any production launch.
        </p>
      </article>

      <SiteFooter />
    </main>
  );
}
