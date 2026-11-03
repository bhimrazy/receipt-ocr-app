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
import { Loader2, Pencil } from "lucide-react";
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
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pencil className="size-5 text-primary" />
          Correct extracted data
        </CardTitle>
        <CardDescription>
          Fix anything the scan misread. Line items keep their original values.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="merchant">
              Merchant
            </label>
            <Input
              id="merchant"
              onChange={(event) => set("merchant", event.target.value)}
              placeholder="Merchant name"
              value={draft.merchant}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="receiptDate">
              Date
            </label>
            <Input
              id="receiptDate"
              onChange={(event) => set("receiptDate", event.target.value)}
              placeholder="YYYY-MM-DD"
              type="date"
              value={draft.receiptDate}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="category">
              Category
            </label>
            <select
              className="h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary"
              id="category"
              onChange={(event) => set("category", event.target.value)}
              value={draft.category}
            >
              {RECEIPT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="currency">
              Currency
            </label>
            <Input
              id="currency"
              maxLength={3}
              onChange={(event) => set("currency", event.target.value.toUpperCase())}
              placeholder="USD"
              value={draft.currency}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="subtotal">
              Subtotal
            </label>
            <Input
              id="subtotal"
              inputMode="decimal"
              onChange={(event) => set("subtotal", event.target.value)}
              placeholder="0.00"
              value={draft.subtotal}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="tax">
              Tax
            </label>
            <Input
              id="tax"
              inputMode="decimal"
              onChange={(event) => set("tax", event.target.value)}
              placeholder="0.00"
              value={draft.tax}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="tip">
              Tip
            </label>
            <Input
              id="tip"
              inputMode="decimal"
              onChange={(event) => set("tip", event.target.value)}
              placeholder="0.00"
              value={draft.tip}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="total">
              Total
            </label>
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
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 sm:col-span-2"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={saving} type="submit">
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
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
