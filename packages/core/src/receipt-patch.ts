import { parseCategory } from "@receipt-ocr/ai/categories";
import { z } from "zod";
import { asciiDigits } from "./calendar/bs";
import { RECEIPT_CALENDARS, type ReceiptCalendar } from "./calendar/resolve";
import { parseReceiptDate } from "./receipt-fields";

/** Fields a user may correct on an extracted receipt. Amounts are `numeric(12,2)` literals; null clears a field. */
export type ReceiptPatch = {
  merchant?: string | null;
  receiptDate?: string | null;
  receiptDateCalendar?: ReceiptCalendar | null;
  category?: string | null;
  currency?: string | null;
  invoiceNumber?: string | null;
  merchantTaxId?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  discount?: string | null;
  serviceCharge?: string | null;
  total?: string | null;
};

type Parsed<T> = { value: T } | { error: string };

/** `numeric(12,2)`: at most 10 digits before the point. */
const MAX_INTEGER_DIGITS = 10;

/**
 * A typed amount as a `numeric(12,2)` literal (`"1234.50"`), null for an empty field, or an error. Spaces and
 * currency symbols are dropped. One `,` or `.` before 1 or 2 digits is the decimal separator (`12,50`); before 3 it
 * groups thousands (`1,234`), as does any separator that repeats or comes before the other one (`1.234,56`,
 * `1,23,456.78`). Anything else, exponents and more than 2 decimals included, is an error: never a guess.
 */
export function parseAmount(input: unknown, { negative = true } = {}): Parsed<string | null> {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== "string" && typeof input !== "number") return { error: "invalid" };
  const text = asciiDigits(String(input)).replace(/[\s\p{Sc}'’]/gu, "");
  if (text === "") return { value: null };
  const match = /^(-?)(\d[\d.,]*)$/.exec(text);
  if (!match) return { error: "invalid" };
  const [, sign, body] = match as unknown as [string, string, string];
  const separators = [...body.matchAll(/[.,]/g)].map((m) => m[0]);
  let integer = body;
  let fraction = "";
  const last = separators.at(-1);
  if (last) {
    const lastIndex = body.lastIndexOf(last);
    const tail = body.slice(lastIndex + 1);
    const decimal =
      separators.filter((s) => s === last).length === 1 &&
      (separators.some((s) => s !== last) || tail.length !== 3);
    if (decimal) {
      if (tail.length < 1 || tail.length > 2) return { error: "invalid" };
      fraction = tail;
      integer = body.slice(0, lastIndex);
    }
    const groups = integer.split(/[.,]/);
    const grouping = new Set(integer.match(/[.,]/g) ?? []);
    if (grouping.size > 1 || (decimal && grouping.has(last))) return { error: "invalid" };
    if (
      groups.length > 1 &&
      (groups.at(-1)!.length !== 3 ||
        groups.slice(1, -1).some((g) => g.length !== 2 && g.length !== 3) ||
        groups[0]!.length > 3 ||
        groups[0]!.length === 0)
    ) {
      return { error: "invalid" };
    }
    integer = groups.join("");
  }
  if (!/^\d+$/.test(integer)) return { error: "invalid" };
  integer = integer.replace(/^0+(?=\d)/, "");
  if (integer.length > MAX_INTEGER_DIGITS) return { error: "too large" };
  if (sign && !negative) return { error: "negative" };
  const value = `${sign}${integer}.${fraction.padEnd(2, "0")}`;
  return { value: /^-0\.00$/.test(value) ? "0.00" : value };
}

function text(input: unknown, max: number): Parsed<string | null> {
  if (input === null || input === undefined) return { value: null };
  if (typeof input !== "string") return { error: "invalid" };
  const trimmed = input.trim();
  if (trimmed.length > max) return { error: "too long" };
  return { value: trimmed === "" ? null : trimmed };
}

function field<T>(parse: (input: unknown) => Parsed<T>, message: (error: string) => string) {
  return z
    .unknown()
    .transform((input, ctx) => {
      const parsed = parse(input);
      if ("error" in parsed) {
        ctx.addIssue(message(parsed.error));
        return z.NEVER;
      }
      return parsed.value;
    })
    .optional();
}

const amount = (label: string, options?: { negative: boolean }) =>
  field(
    (input) => parseAmount(input, options),
    (error) =>
      error === "negative"
        ? `${label} can't be negative.`
        : error === "too large"
          ? `${label} is too large.`
          : `${label} must be an amount, like 12.50.`,
  );

const limited = (label: string, max: number) =>
  field(
    (input) => text(input, max),
    (error) =>
      error === "too long"
        ? `${label} can be at most ${max} characters.`
        : `${label} must be text.`,
  );

const receiptPatchSchema = z.strictObject({
  merchant: limited("Merchant", 200),
  receiptDate: field(
    (input) => {
      const parsed = text(input, 32);
      if ("error" in parsed || parsed.value === null) return parsed;
      return parseReceiptDate(parsed.value) === parsed.value ? parsed : { error: "invalid" };
    },
    () => "Enter a real date from 2000 on, as YYYY-MM-DD.",
  ),
  receiptDateCalendar: field(
    (input): Parsed<ReceiptCalendar | null> =>
      input === null || input === ""
        ? { value: null }
        : RECEIPT_CALENDARS.includes(input as ReceiptCalendar)
          ? { value: input as ReceiptCalendar }
          : { error: "invalid" },
    () => "The calendar must be gregory or bikram-sambat.",
  ),
  category: field(
    (input) => {
      const parsed = text(input, 40);
      if ("error" in parsed || parsed.value === null) return parsed;
      const category = parseCategory(parsed.value);
      return category ? { value: category } : { error: "invalid" };
    },
    () => "Unknown category.",
  ),
  currency: field(
    (input) => {
      const parsed = text(input, 3);
      if ("error" in parsed || parsed.value === null) return parsed;
      return /^[A-Za-z]{3}$/.test(parsed.value)
        ? { value: parsed.value.toUpperCase() }
        : { error: "invalid" };
    },
    () => "Currency must be a 3-letter code, like USD.",
  ),
  invoiceNumber: limited("Bill number", 64),
  merchantTaxId: limited("Tax ID", 32),
  subtotal: amount("Subtotal"),
  tax: amount("Tax"),
  tip: amount("Tip"),
  discount: amount("Discount", { negative: false }),
  serviceCharge: amount("Service charge", { negative: false }),
  total: amount("Total"),
});

/**
 * A PATCH body as a `ReceiptPatch`, or the first problem in words. Unknown fields are refused, and a field that
 * doesn't parse is an error, never dropped. The date's upper bound (the upload day + 1) is checked by the
 * repository, which knows the upload time.
 */
export function parseReceiptPatch(body: unknown): { patch: ReceiptPatch } | { error: string } {
  const result = receiptPatchSchema.safeParse(body);
  if (result.success) {
    return {
      patch: Object.fromEntries(
        Object.entries(result.data).filter(([, value]) => value !== undefined),
      ) as ReceiptPatch,
    };
  }
  const issue = result.error.issues[0]!;
  return {
    error:
      issue.code === "unrecognized_keys"
        ? `Unknown field: ${issue.keys.join(", ")}`
        : issue.code === "custom"
          ? issue.message
          : "Send the changes as a JSON object.",
  };
}
