import { jsonSchema, zodSchema, type Schema } from "ai";
import { z } from "zod";
import { CATEGORY_DESCRIPTIONS, RECEIPT_CATEGORIES } from "./categories";
import type { PromptVersion } from "./prompt";

/**
 * Field definitions, sent in the JSON schema from v2 on so both providers read the same ones.
 * They follow the benchmark's answer-key rules (`bench/README.md`).
 */
export const FIELD_DESCRIPTIONS = {
  merchant:
    "The store or trading name, as on the sign or logo. Not the legal company name (Pvt. Ltd., S.A., Inc.) and without branch, address or location, unless the legal name is the only name printed. For a payment or transfer screenshot, the payee.",
  receiptDate:
    "The transaction date in the Gregorian (AD) calendar as YYYY-MM-DD, or null when none is printed or legible. When a Bikram Sambat date (Miti, year 2070 to 2090) is printed beside it, the AD date is often MM/DD/YYYY: choose the day and month order that matches the Miti's month. A Bikram Sambat date alone gives null.",
  category: `Exactly one of: ${RECEIPT_CATEGORIES.map((c) => `${c} (${CATEGORY_DESCRIPTIONS[c]})`).join("; ")}.`,
  currency:
    "ISO 4217 code of the amounts. When no code or symbol settles it, infer it from the country (address, phone code, tax id, language) and the currency in force on the receipt date.",
  subtotal:
    "The printed pre-tax goods line: Sub Total, STTL, Gross Amount, or a Total printed before tax, service charge or discounts. If several are printed, the one labelled subtotal. null when no such line is printed; never add up the items yourself.",
  tax: "The sum of every printed tax amount (VAT, GST, CGST + SGST, PB1, sales tax), whether added on top or included in the prices. null when no tax amount is printed. Service charge, discounts and rounding are not tax.",
  tip: "A printed or handwritten tip or gratuity, else null. A service charge is not a tip.",
  total:
    "The printed grand total or amount due, after tax, service charge, discounts and rounding. Not the cash tendered or the change. If a grand total and a separately rounded amount paid are both printed, the grand total.",
  confidence: "0 to 1: how legible the receipt was overall.",
  items:
    "Every purchased goods or charge line, in printed order, including fee lines that add up to the total (Base Fare, Service Fee). Not subtotal, tax, tip, payment or change lines, nor a service charge or discount printed below the subtotal. [] when there are none, such as a transfer screenshot.",
  itemName:
    "The line's text as printed: same spelling, abbreviations, script and diacritics. Add no words, codes, quantities or rates.",
  quantity: "The printed quantity or weight; 1 when none is printed.",
  unitPrice: "The printed unit price, else totalPrice / quantity.",
  totalPrice:
    "The line's amount after any discount printed for that line. A discount line under an item (Rabat, Discount, -2.00) is subtracted from that item, not listed as an item.",
  itemConfidence: "0 to 1: how legible this line was.",
} as const;

type FieldKey = keyof typeof FIELD_DESCRIPTIONS;

// Length caps bound what a crafted image can make the model emit (cost, stored rows).
function buildSchema(described: boolean) {
  const d = <T extends z.ZodType>(schema: T, key: FieldKey): T =>
    described ? schema.describe(FIELD_DESCRIPTIONS[key]) : schema;
  const confidence = (key: FieldKey) => d(z.number().min(0).max(1), key);
  return z.object({
    merchant: d(z.string().max(200), "merchant"),
    receiptDate: d(z.string().max(32).nullable(), "receiptDate"),
    category: d(z.enum(RECEIPT_CATEGORIES), "category"),
    currency: z
      .string()
      .length(3)
      .describe(described ? FIELD_DESCRIPTIONS.currency : "ISO 4217 currency code, e.g. USD"),
    subtotal: d(z.number().nullable(), "subtotal"),
    tax: d(z.number().nullable(), "tax"),
    tip: d(z.number().nullable(), "tip"),
    total: d(z.number(), "total"),
    confidence: confidence("confidence"),
    items: d(
      z
        .array(
          z.object({
            name: d(z.string().max(300), "itemName"),
            quantity: d(z.number(), "quantity"),
            unitPrice: d(z.number(), "unitPrice"),
            totalPrice: d(z.number(), "totalPrice"),
            confidence: confidence("itemConfidence"),
          }),
        )
        .max(300),
      "items",
    ),
  });
}

/** The single source of truth for an extraction: validated by the AI SDK, typed via `z.infer`. */
export const receiptExtractionSchema = buildSchema(true);

/** v1's wire schema: the same shape and bounds without field definitions, kept for the A/B. */
const receiptExtractionSchemaV1 = buildSchema(false);

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

function withoutKeyword(node: unknown, keyword: string): unknown {
  if (Array.isArray(node)) return node.map((child) => withoutKeyword(child, keyword));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== keyword)
        .map(([key, value]) => [key, withoutKeyword(value, keyword)]),
    );
  }
  return node;
}

/**
 * The schema sent to the model for a prompt version. With `schemaMode` "no-array-bounds" it is
 * the same JSON schema minus `maxItems`; the reply is still validated against
 * `receiptExtractionSchema`, bounds included.
 */
export function receiptRequestSchema(
  version: PromptVersion,
  schemaMode: "full" | "no-array-bounds" = "full",
): Schema<ReceiptExtraction> {
  const wire = version === "v1" ? receiptExtractionSchemaV1 : receiptExtractionSchema;
  if (schemaMode === "full") return zodSchema(wire);
  return jsonSchema<ReceiptExtraction>(
    async () => withoutKeyword(await zodSchema(wire).jsonSchema, "maxItems") as never,
    {
      validate: (value) => {
        const parsed = receiptExtractionSchema.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );
}
