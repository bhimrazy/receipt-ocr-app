import { parseCategory } from "@receipt-ocr/ai/categories";
import { z } from "zod";
import { asciiDigits, RECEIPT_CALENDARS, type ReceiptCalendar } from "@receipt-ocr/calendar";
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
 * currency symbols are dropped. A dot is always the decimal mark, with at most 2 decimals. Commas group thousands,
 * Western or Indian (`1,234,567`, `1,23,456.50`). The one other comma read is a decimal comma that can't be a
 * grouping (`12,50`). Anything else, exponents included, is an error: never a guess.
 */
export function parseAmount(input: unknown, { negative = true } = {}): Parsed<string | null> {
  if (input === null || input === undefined) return { value: null };
  if (typeof input === "number") return fromNumber(input, negative);
  if (typeof input !== "string") return { error: "invalid" };
  const text = asciiDigits(input).replace(/[\s\p{Sc}]/gu, "");
  if (text === "") return { value: null };
  const match =
    /^(-?)(\d{1,3}(?:,\d{2,3})*,\d{3}|\d+)(?:\.(\d{1,2}))?$/.exec(text) ??
    /^(-?)(\d+),(\d{1,2})$/.exec(text);
  if (!match) return { error: "invalid" };
  const [, sign = "", whole = "", fraction = ""] = match;
  return literal(sign, whole.replaceAll(",", ""), fraction, negative);
}

/** A JSON number is already a value, never read through the grouping rules. */
function fromNumber(value: number, negative: boolean): Parsed<string | null> {
  if (!Number.isFinite(value)) return { error: "invalid" };
  const cents = Math.round(value * 100);
  if (Math.abs(value * 100 - cents) > 1e-6) return { error: "invalid" };
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return literal(cents < 0 ? "-" : "", digits.slice(0, -2), digits.slice(-2), negative);
}

function literal(
  sign: string,
  integer: string,
  fraction: string,
  negative: boolean,
): Parsed<string | null> {
  const whole = integer.replace(/^0+(?=\d)/, "");
  if (whole.length > MAX_INTEGER_DIGITS) return { error: "too large" };
  const value = `${whole}.${fraction.padEnd(2, "0")}`;
  if (value === "0.00") return { value };
  if (sign && !negative) return { error: "negative" };
  return { value: `${sign}${value}` };
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
