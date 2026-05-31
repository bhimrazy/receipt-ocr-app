import { ReceiptText } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_30%,transparent)]">
        <ReceiptText className="size-4" />
      </div>
      {!compact && (
        <span className="font-mono text-sm font-semibold tracking-tight">
          receipt<span className="text-primary">OCR</span>
        </span>
      )}
    </div>
  );
}
