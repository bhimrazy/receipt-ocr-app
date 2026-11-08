"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { reportBoundaryError } from "@/lib/telemetry/client-errors";

/**
 * Shown when a server component in /app throws — most often a database or
 * storage failure. We deliberately surface this instead of silently falling
 * back to sample data, which would make a broken database look like an empty
 * (or worse, someone else's) account.
 */
export default function AppError({
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
        event: "app.render_error",
        message: error.message,
        digest: error.digest,
      }),
    );
    reportBoundaryError(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-lg items-center py-20">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert aria-hidden="true" className="size-5 text-destructive" />
            Something went wrong
          </CardTitle>
          <CardDescription>
            We couldn&apos;t load this page. This is usually temporary, and trying again often
            works.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={reset}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
          <Link className={buttonVariants({ variant: "outline" })} href="/app">
            Back to Home
          </Link>
          {error.digest ? (
            <span className="font-mono text-xs text-muted-foreground">ref {error.digest}</span>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
