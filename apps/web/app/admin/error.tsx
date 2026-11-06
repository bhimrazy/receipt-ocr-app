"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/** Shown when an admin page fails to load, usually a database error. */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "admin.render_error",
        message: error.message,
        digest: error.digest,
      }),
    );
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-border bg-card p-6" role="alert">
      <h1 className="flex items-center gap-2 text-lg font-semibold">
        <TriangleAlert aria-hidden="true" className="size-5 text-destructive" />
        This page didn&apos;t load
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The server couldn&apos;t read the data for this page. This is usually a short database
        problem, so trying again often works. Nothing was changed.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={reset}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin">
          Go to the overview
        </Link>
        {error.digest ? (
          <span className="font-mono text-xs text-muted-foreground">ref {error.digest}</span>
        ) : null}
      </div>
    </div>
  );
}
