import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SiteFooter } from "@/components/site-footer";

export type LegalSection = { heading: string; body: string[] };

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Slim header shared by legal and error pages, sized to their max-w-3xl column. */
export function SlimHeader() {
  return (
    <header className="border-b border-border px-5">
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between">
        <Link
          aria-label="receiptOCR home"
          className={`inline-flex min-h-11 items-center rounded-lg ${focusRing}`}
          href="/"
        >
          <Brand />
        </Link>
        <Link
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground ${focusRing}`}
          href="/"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to home
        </Link>
      </div>
    </header>
  );
}

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
    <>
      <SlimHeader />
      <main className="bg-background text-foreground">
        <article className="mx-auto max-w-3xl px-5 py-14 md:py-16">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-primary">Legal</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-3 font-mono text-xs text-muted-foreground">Last updated {updated}</p>
          <p className="mt-6 text-pretty leading-7 text-foreground/85">{intro}</p>

          {process.env.NODE_ENV !== "production" && (
            <p className="mt-8 rounded-xl bg-amber-400/10 p-4 text-sm leading-6 text-amber-200 ring-1 ring-inset ring-amber-400/30">
              Development only: this copy has not had legal review yet. This note is hidden in
              production.
            </p>
          )}

          <div className="mt-10 flex flex-col gap-9">
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
        </article>
      </main>
      <SiteFooter narrow />
    </>
  );
}
