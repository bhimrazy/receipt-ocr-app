import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { SlimHeader } from "@/components/legal-page";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <>
      <SlimHeader />
      <main className="relative grid min-h-[calc(100vh-12rem)] place-items-center overflow-hidden bg-background px-5 py-20">
        <div aria-hidden className="grid-mask pointer-events-none absolute inset-0 opacity-40">
          <div className="receipt-grid absolute -inset-1" />
        </div>
        <div className="relative max-w-md text-center">
          <p className="font-mono text-sm tracking-[0.22em] text-primary">404</p>
          <h1 className="mt-4 text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Page not found
          </h1>
          <p className="mt-4 text-pretty leading-7 text-muted-foreground">
            The link may be old, or the page may have moved.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")} href="/">
              Back to home
            </Link>
            <Link
              className={cn(buttonVariants({ size: "lg", variant: "outline" }), "w-full sm:w-auto")}
              href="/app"
            >
              Open the app
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter narrow />
    </>
  );
}
