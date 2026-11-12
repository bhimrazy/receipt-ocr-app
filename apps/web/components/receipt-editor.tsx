"use client";

import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import type { ReceiptWithItems } from "@receipt-ocr/core";
import {
  adToBs,
  bsIso,
  bsToAd,
  parseBsInput,
  type ReceiptCalendar,
} from "@receipt-ocr/core/calendar";
import { EARLIEST_RECEIPT_DATE, latestReceiptDate } from "@receipt-ocr/core/receipt-fields";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Field, FieldDescription, FieldLabel } from "@receipt-ocr/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { apiRequest } from "@/lib/api-request";
import { formatDate } from "@/lib/format";

type Draft = {
  merchant: string;
  /** AD, `YYYY-MM-DD`: what the AD field holds and what is saved. */
  receiptDate: string;
  /** What the BS field holds, as typed. */
  receiptDateBs: string;
  receiptDateCalendar: ReceiptCalendar;
  category: string;
  currency: string;
  invoiceNumber: string;
  merchantTaxId: string;
  subtotal: string;
  discount: string;
  serviceCharge: string;
  tax: string;
  tip: string;
  total: string;
};

const AMOUNTS = [
  ["subtotal", "Subtotal"],
  ["discount", "Discount"],
  ["serviceCharge", "Service charge"],
  ["tax", "Tax"],
  ["tip", "Tip"],
  ["total", "Total"],
] as const;

function draftFrom(receipt: ReceiptWithItems): Draft {
  const bs = receipt.receiptDate ? adToBs(receipt.receiptDate) : null;
  return {
    merchant: receipt.merchant ?? "",
    receiptDate: receipt.receiptDate ?? "",
    receiptDateBs: bs ? bsIso(bs) : "",
    receiptDateCalendar:
      receipt.receiptDateCalendar === "bikram-sambat" ? "bikram-sambat" : "gregory",
    category: receipt.category ?? "Other",
    currency: receipt.currency ?? "USD",
    invoiceNumber: receipt.invoiceNumber ?? "",
    merchantTaxId: receipt.merchantTaxId ?? "",
    subtotal: receipt.subtotal ?? "",
    discount: receipt.discount ?? "",
    serviceCharge: receipt.serviceCharge ?? "",
    tax: receipt.tax ?? "",
    tip: receipt.tip ?? "",
    total: receipt.total ?? "",
  };
}

const labelClass = "text-xs text-muted-foreground";

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

const CALENDARS: { value: ReceiptCalendar; label: string; name: string }[] = [
  { value: "gregory", label: "AD", name: "Gregorian (AD)" },
  { value: "bikram-sambat", label: "BS", name: "Bikram Sambat (BS)" },
];

// The selected segment is told apart by its fill and edge, not by colour alone (as the theme toggle).
const segmentClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-background aria-checked:text-foreground aria-checked:inset-ring aria-checked:inset-ring-border md:min-h-7";

/** AD · BS as a radio group: arrow keys move and select, Tab leaves. */
function CalendarToggle({
  value,
  onChange,
}: {
  value: ReceiptCalendar;
  onChange: (value: ReceiptCalendar) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function choose(index: number) {
    const option = CALENDARS[(index + CALENDARS.length) % CALENDARS.length]!;
    onChange(option.value);
    refs.current[CALENDARS.indexOf(option)]?.focus();
  }
  return (
    <div
      aria-label="Calendar the receipt prints"
      className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5"
      role="radiogroup"
    >
      {CALENDARS.map((option, index) => (
        <button
          aria-checked={value === option.value}
          aria-label={option.name}
          className={segmentClass}
          key={option.value}
          onClick={() => choose(index)}
          onKeyDown={(event) => {
            const next = {
              ArrowRight: index + 1,
              ArrowDown: index + 1,
              ArrowLeft: index - 1,
              ArrowUp: index - 1,
            }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            choose(next);
          }}
          ref={(node) => {
            refs.current[index] = node;
          }}
          role="radio"
          tabIndex={value === option.value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The AD day a BS entry stands for, or why it can't be saved. Empty is "no date"; an entry must also fall
 * within what the server accepts (2000-01-01 to a day after the upload).
 */
function bsEntry(text: string, latest: string): { ad: string | null } | { error: string } {
  if (!text.trim()) return { ad: null };
  const bs = parseBsInput(text);
  const ad = bs ? bsToAd(bs) : null;
  if (!ad) return { error: "Enter a BS date as YYYY-MM-DD, like 2080-04-09." };
  if (ad < EARLIEST_RECEIPT_DATE || ad > latest) {
    return { error: "That BS date is outside the dates a receipt can have." };
  }
  return { ad };
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
  const [initial] = useState<Draft>(() => draftFrom(receipt));
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories] = useState(() => categoryItems(receipt.category ?? "Other"));
  const latest = latestReceiptDate(receipt.createdAt);
  const bs = draft.receiptDateCalendar === "bikram-sambat";
  const entry = bs ? bsEntry(draft.receiptDateBs, latest) : null;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /** Switching keeps the day: the other field is filled from the one in use. */
  function switchCalendar(calendar: ReceiptCalendar) {
    setDraft((current) => {
      if (calendar === current.receiptDateCalendar) return current;
      if (calendar === "bikram-sambat") {
        const day = current.receiptDate ? adToBs(current.receiptDate) : null;
        return { ...current, receiptDateCalendar: calendar, receiptDateBs: day ? bsIso(day) : "" };
      }
      const typed = bsEntry(current.receiptDateBs, latest);
      return {
        ...current,
        receiptDateCalendar: calendar,
        receiptDate: "ad" in typed ? (typed.ad ?? "") : current.receiptDate,
      };
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (entry && "error" in entry) {
      setError(entry.error);
      return;
    }
    const final = { ...draft, receiptDate: entry ? (entry.ad ?? "") : draft.receiptDate };
    // Only what changed: an untouched field is never re-validated or re-saved.
    const changes = Object.fromEntries(
      (Object.keys(final) as (keyof Draft)[])
        .filter((key) => key !== "receiptDateBs" && final[key] !== initial[key])
        .map((key) => [key, final[key]]),
    );
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await apiRequest(
      `/api/receipts/${receipt.id}`,
      "PATCH",
      changes,
      "Couldn't save your changes.",
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
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
          Correct the details
        </CardTitle>
        <CardDescription>
          Fix anything that was misread. Your corrections are what gets exported. Line items
          can&apos;t be edited yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
          <Field className="sm:col-span-2">
            <FieldLabel className={labelClass} htmlFor="merchant">
              Merchant
            </FieldLabel>
            <Input
              id="merchant"
              maxLength={200}
              onChange={(event) => set("merchant", event.target.value)}
              placeholder="Merchant name"
              value={draft.merchant}
            />
          </Field>

          <Field className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel className={labelClass} htmlFor="receiptDate">
                Date
              </FieldLabel>
              <CalendarToggle onChange={switchCalendar} value={draft.receiptDateCalendar} />
            </div>
            {bs ? (
              <>
                <Input
                  aria-describedby="receiptDate-preview"
                  aria-invalid={entry !== null && "error" in entry}
                  autoComplete="off"
                  id="receiptDate"
                  inputMode="numeric"
                  onChange={(event) => set("receiptDateBs", event.target.value)}
                  placeholder="YYYY-MM-DD (BS)"
                  value={draft.receiptDateBs}
                />
                <FieldDescription
                  aria-live="polite"
                  className={cn(
                    "text-xs",
                    entry && "error" in entry && draft.receiptDateBs.trim() && "text-destructive",
                  )}
                  id="receiptDate-preview"
                >
                  {entry && "ad" in entry
                    ? entry.ad
                      ? `${formatDate(entry.ad)} in AD`
                      : "Year, month and day in Bikram Sambat."
                    : entry?.error}
                </FieldDescription>
              </>
            ) : (
              <Input
                id="receiptDate"
                max={latest}
                min={EARLIEST_RECEIPT_DATE}
                onChange={(event) => set("receiptDate", event.target.value)}
                placeholder="YYYY-MM-DD"
                type="date"
                value={draft.receiptDate}
              />
            )}
          </Field>

          <Field>
            <FieldLabel className={labelClass} htmlFor="category">
              Category
            </FieldLabel>
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
          </Field>

          <Field>
            <FieldLabel className={labelClass} htmlFor="currency">
              Currency
            </FieldLabel>
            <Input
              autoCapitalize="characters"
              id="currency"
              onChange={(event) => set("currency", event.target.value.toUpperCase())}
              placeholder="USD"
              value={draft.currency}
            />
          </Field>

          <Field>
            <FieldLabel className={labelClass} htmlFor="invoiceNumber">
              Bill number
            </FieldLabel>
            <Input
              autoComplete="off"
              id="invoiceNumber"
              maxLength={64}
              onChange={(event) => set("invoiceNumber", event.target.value)}
              placeholder="As printed"
              value={draft.invoiceNumber}
            />
          </Field>

          <Field>
            <FieldLabel className={labelClass} htmlFor="merchantTaxId">
              Merchant tax ID
            </FieldLabel>
            <Input
              autoComplete="off"
              id="merchantTaxId"
              maxLength={32}
              onChange={(event) => set("merchantTaxId", event.target.value)}
              placeholder="PAN, VAT or GST number"
              value={draft.merchantTaxId}
            />
          </Field>

          {AMOUNTS.map(([key, label]) => (
            <Field key={key}>
              <FieldLabel className={labelClass} htmlFor={key}>
                {label}
              </FieldLabel>
              <Input
                id={key}
                inputMode="decimal"
                onChange={(event) => set(key, event.target.value)}
                placeholder="0.00"
                value={draft[key]}
              />
            </Field>
          ))}

          {error ? (
            <Alert className="sm:col-span-2" variant="destructive">
              {error}
            </Alert>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={saving} type="submit">
              {saving ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
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
