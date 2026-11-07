"use client";

import { Alert, AlertDescription, AlertTitle } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import { CircleAlert, Share2 } from "lucide-react";
import type { RefObject } from "react";
import { useSharedFiles } from "@/lib/use-shared-files";

/** Files shared from another app, which wait for Keep or Discard before joining the queue. */
export function SharedFilesNotice({ input }: { input: RefObject<HTMLInputElement | null> }) {
  const { files, problem, keep, discard } = useSharedFiles(input);
  return (
    <>
      {problem ? (
        <Alert className="px-4 py-3" variant="warning">
          <CircleAlert aria-hidden="true" />
          <p>{problem}</p>
        </Alert>
      ) : null}
      {files.length > 0 ? (
        <Alert aria-label="Shared files" className="px-4 py-3" variant="info">
          <Share2 aria-hidden="true" />
          <AlertTitle>
            {files.length === 1
              ? "1 file shared from another app"
              : `${files.length} files shared from another app`}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
              {files.map((file, index) => (
                <li className="truncate" key={`${index}-${file.name}`}>
                  {file.name}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-muted-foreground">
              They were shared to receiptOCR on this device. Keep them only if you shared them.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={keep} size="sm">
                Keep
              </Button>
              <Button onClick={discard} size="sm" variant="outline">
                Discard
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
