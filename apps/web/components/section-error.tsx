"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { RotateCw, TriangleAlert } from "lucide-react";
import { catchError, type ErrorInfo } from "next/error";
import { useEffect } from "react";
import { reportBoundaryError } from "@/lib/telemetry/client-errors";

type Props = {
  /** Names the part of the page that failed, e.g. "Recent receipts". */
  label: string;
  className?: string;
};

export function SectionErrorCard({ label, className, retry }: Props & { retry: () => void }) {
  return (
    <Card className={cn("flex flex-col gap-3 p-5", className)} role="alert">
      <p className="flex items-start gap-2 text-sm font-medium">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        {label} couldn&apos;t load.
      </p>
      <p className="text-sm text-muted-foreground">
        This is usually temporary. The rest of the page still works.
      </p>
      <div>
        <Button onClick={retry} size="sm" variant="outline">
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
      </div>
    </Card>
  );
}

function SectionErrorFallback(props: Props, { error, retry }: ErrorInfo) {
  useEffect(() => {
    if (error instanceof Error) reportBoundaryError(error);
  }, [error]);
  return <SectionErrorCard {...props} retry={retry} />;
}

/**
 * An error boundary for one streamed section: a failed or timed-out read shows a card with a
 * retry in place of that section, instead of taking the page to its error screen.
 */
export const SectionBoundary = catchError(SectionErrorFallback);
