"use client";

import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { Loader2, Pencil, TriangleAlert } from "lucide-react";
import { confidenceLevel } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Draft = {
  merchant: string;
  receiptDate: string;
  category: string;
  currency: string;
  subtotal: string;
  tax: string;
  tip: string;
  total: string;
};

function draftFrom(receipt: ReceiptWithItems): Draft {
  return {
    merchant: receipt.merchant ?? "",
    receiptDate: receipt.receiptDate ?? "",
    category: receipt.category ?? "Other",
    currency: receipt.currency ?? "USD",
    subtotal: receipt.subtotal ?? "",
    tax: receipt.tax ?? "",
    tip: receipt.tip ?? "",
    total: receipt.total ?? "",
  };
}

const labelClass = "mb-1.5 block text-xs font-medium text-muted-foreground";

/** Canonical list, plus the stored value when it isn't in it, so what you see is what saves. */
function categoryItems(current: string) {
  const items: { value: string; label: string }[] = RECEIPT_CATEGORIES.map((category) => ({
    value: category,
    label: category,
  }));
  if (current && !items.some((item) => item.value === current)) {
    items.unshift({ value: current, label: `${current} (unrecognised)` });
  }
  return items;
}

/**
 * Correcting extracted values. Showing a confidence score without a way to fix
 * a wrong reading leaves the user stuck with data they know is wrong, so every
 * human-correctable field is editable here. Everything else — status,
 * confidence, the raw extraction — stays server-owned.
 */
export function ReceiptEditor({
  receipt,
  onClose,
}: {
  receipt: ReceiptWithItems;
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(receipt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories] = useState(() => categoryItems(receipt.category ?? "Other"));
  const lowConfidence = confidenceLevel(receipt.confidence);

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/receipts/${receipt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Couldn't save your changes.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pencil aria-hidden="true" className="size-5 text-primary" />
          Correct extracted data
        </CardTitle>
        <CardDescription>
          Fix anything that was misread. Your corrections are what gets exported. Line items
          can&apos;t be edited yet.
        </CardDescription>
        {lowConfidence === "check" || lowConfidence === "review" ? (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Parts of this receipt were hard to read. Check the merchant, date and total against the
            photo first.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <div className="sm:col-span-2">
            <Label className={labelClass} htmlFor="merchant">
              Merchant
            </Label>
            <Input
              id="merchant"
              onChange={(event) => set("merchant", event.target.value)}
              placeholder="Merchant name"
              value={draft.merchant}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="receiptDate">
              Date
            </Label>
            <Input
              id="receiptDate"
              onChange={(event) => set("receiptDate", event.target.value)}
              placeholder="YYYY-MM-DD"
              type="date"
              value={draft.receiptDate}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="category">
              Category
            </Label>
            <Select
              items={categories}
              onValueChange={(value) => value && set("category", value as string)}
              value={draft.category}
            >
              <SelectTrigger className="w-full" id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {categories.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className={labelClass} htmlFor="currency">
              Currency
            </Label>
            <Input
              id="currency"
              maxLength={3}
              onChange={(event) => set("currency", event.target.value.toUpperCase())}
              placeholder="USD"
              value={draft.currency}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="subtotal">
              Subtotal
            </Label>
            <Input
              id="subtotal"
              inputMode="decimal"
              onChange={(event) => set("subtotal", event.target.value)}
              placeholder="0.00"
              value={draft.subtotal}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="tax">
              Tax
            </Label>
            <Input
              id="tax"
              inputMode="decimal"
              onChange={(event) => set("tax", event.target.value)}
              placeholder="0.00"
              value={draft.tax}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="tip">
              Tip
            </Label>
            <Input
              id="tip"
              inputMode="decimal"
              onChange={(event) => set("tip", event.target.value)}
              placeholder="0.00"
              value={draft.tip}
            />
          </div>

          <div>
            <Label className={labelClass} htmlFor="total">
              Total
            </Label>
            <Input
              id="total"
              inputMode="decimal"
              onChange={(event) => set("total", event.target.value)}
              placeholder="0.00"
              value={draft.total}
            />
          </div>

          {error ? (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={saving} type="submit">
              {saving ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              Save changes
            </Button>
            <Button disabled={saving} onClick={onClose} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
