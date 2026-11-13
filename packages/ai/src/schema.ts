import { jsonSchema, zodSchema, type Schema } from "ai";
import { z } from "zod";
import { CATEGORY_DESCRIPTIONS, RECEIPT_CATEGORIES } from "./categories";
import type { PromptVersion } from "./prompt";

/**
 * Field definitions, sent in the JSON schema from v2 on so both providers read the same ones.
 * They follow the benchmark's answer-key rules (`packages/bench/README.md`).
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

/**
 * v3's definitions: v2's, with null allowed where a value can't be read, dates copied as printed
 * instead of converted, and the bill number, seller tax id, discount and service charge as fields.
 */
export const V3_FIELD_DESCRIPTIONS = {
  ...FIELD_DESCRIPTIONS,
  merchant: `${FIELD_DESCRIPTIONS.merchant} null when no name is legible; never a guess from the items or the address.`,
  receiptDate:
    "Your reading of the sale date in the Gregorian (AD) calendar as YYYY-MM-DD, or null. Never convert a Bikram Sambat date: when only a BS date is printed, null. The stored date is decided from dates.",
  currency: `${FIELD_DESCRIPTIONS.currency} null when nothing on the receipt settles it.`,
  total: `${FIELD_DESCRIPTIONS.total} null when no total is printed or legible; never add it up yourself.`,
  dates:
    "Every date printed on the receipt, in printed order, at most 4: the sale or issue date, a Miti beside it, due or delivery dates. Not a fiscal year such as 2081/82, and not a time. [] when none is printed.",
  dateText:
    "The date exactly as printed: the same digits (Devanagari stays Devanagari), separators, order and month names, without the time.",
  dateLabel:
    "The label printed with it (Date, Miti, मिति, वि.सं., B.S., A.D., Bill Date, Due Date), else null.",
  dateCalendar:
    "bikram-sambat when the receipt marks this date as Bikram Sambat (Miti, मिति, B.S., वि.सं., a Nepali month name); gregory when it marks it as Gregorian (A.D., ई.सं., an English month name); null when nothing printed marks it.",
  dateRole:
    "transaction for the sale or issue date and a Miti beside it; other for due, delivery, expiry or validity dates.",
  invoiceNumber:
    "The seller's bill or invoice number for this sale (Bill No., Invoice No., Inv. No., Tax Invoice No., Receipt No., बिल नं., बीजक नं.), copied exactly with prefixes, dashes, slashes and fiscal-year parts. null when none is printed. Never a PAN or VAT number, phone, table, KOT, order, token, queue, terminal, cashier, card, approval or transaction id.",
  merchantTaxId:
    "The seller's tax registration number as printed (PAN, VAT No., PAN/VAT No., स्थायी लेखा नं., GSTIN, VAT ID, EIN, ABN, TIN), else null. Never the buyer's or customer's PAN.",
  discount:
    "A printed bill-level discount as a positive amount, else null. Not a discount printed under one line, which goes in that line's totalPrice.",
  serviceCharge:
    "A printed service charge amount (Service Charge 10%, S.C., SC), else null. Not tax and not a tip.",
} as const;

type FieldKey = keyof typeof V3_FIELD_DESCRIPTIONS;

function describer(descriptions: Partial<Record<FieldKey, string>> | null) {
  return <T extends z.ZodType>(schema: T, key: FieldKey): T => {
    const text = descriptions?.[key];
    return text ? schema.describe(text) : schema;
  };
}

type Describe = ReturnType<typeof describer>;

// Length caps bound what a crafted image can make the model emit (cost, stored rows).
const itemsSchema = (d: Describe) =>
  d(
    z
      .array(
        z.object({
          name: d(z.string().max(300), "itemName"),
          quantity: d(z.number(), "quantity"),
          unitPrice: d(z.number(), "unitPrice"),
          totalPrice: d(z.number(), "totalPrice"),
          confidence: d(z.number().min(0).max(1), "itemConfidence"),
        }),
      )
      .max(300),
    "items",
  );

function buildV2Schema(described: boolean) {
  const d = describer(described ? FIELD_DESCRIPTIONS : null);
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
    confidence: d(z.number().min(0).max(1), "confidence"),
    items: itemsSchema(d),
  });
}

/** Every field is required and nullable, never optional: strict JSON-schema modes take that as is. */
function buildV3Schema() {
  const d = describer(V3_FIELD_DESCRIPTIONS);
  return z.object({
    merchant: d(z.string().max(200).nullable(), "merchant"),
    receiptDate: d(z.string().max(32).nullable(), "receiptDate"),
    dates: d(
      z
        .array(
          z.object({
            text: d(z.string().max(40), "dateText"),
            label: d(z.string().max(40).nullable(), "dateLabel"),
            calendar: d(z.enum(["gregory", "bikram-sambat"]).nullable(), "dateCalendar"),
            role: d(z.enum(["transaction", "other"]), "dateRole"),
          }),
        )
        .max(4),
      "dates",
    ),
    invoiceNumber: d(z.string().max(64).nullable(), "invoiceNumber"),
    merchantTaxId: d(z.string().max(32).nullable(), "merchantTaxId"),
    category: d(z.enum(RECEIPT_CATEGORIES), "category"),
    currency: d(z.string().length(3).nullable(), "currency"),
    subtotal: d(z.number().nullable(), "subtotal"),
    discount: d(z.number().nullable(), "discount"),
    serviceCharge: d(z.number().nullable(), "serviceCharge"),
    tax: d(z.number().nullable(), "tax"),
    tip: d(z.number().nullable(), "tip"),
    total: d(z.number().nullable(), "total"),
    confidence: d(z.number().min(0).max(1), "confidence"),
    items: itemsSchema(d),
  });
}

/** The current wire schema (v3): validated by the AI SDK, typed via `z.infer`. */
export const receiptExtractionSchema = buildV3Schema();

type ExtractionV3 = z.infer<typeof receiptExtractionSchema>;
type AddedInV3 = "dates" | "invoiceNumber" | "merchantTaxId" | "discount" | "serviceCharge";

/**
 * An extraction from any prompt version. v1 and v2 replies, and the `raw_json` they wrote, lack
 * the fields v3 added, so those are optional here.
 */
export type ReceiptExtraction = Omit<ExtractionV3, AddedInV3> &
  Partial<Pick<ExtractionV3, AddedInV3>>;

/** v1 is v2's shape and bounds without field definitions; both stay for the A/B. */
const WIRE_SCHEMAS: Record<PromptVersion, z.ZodType<ReceiptExtraction>> = {
  v1: buildV2Schema(false),
  v2: buildV2Schema(true),
  v3: receiptExtractionSchema,
};

function withoutKeywords(node: unknown, keywords: readonly string[]): unknown {
  if (Array.isArray(node)) return node.map((child) => withoutKeywords(child, keywords));
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !keywords.includes(key))
        .map(([key, value]) => [key, withoutKeywords(value, keywords)]),
    );
  }
  return node;
}

/**
 * The schema sent to the model for a prompt version. "no-array-bounds" is the same JSON schema
 * minus `maxItems`; "no-bounds" also drops string and number bounds. The reply is still
 * validated against that version's full schema, bounds included.
 */
const DROPPED_KEYWORDS = {
  "no-array-bounds": ["maxItems"],
  "no-bounds": ["maxItems", "minItems", "maxLength", "minLength", "minimum", "maximum"],
} as const;

export function receiptRequestSchema(
  version: PromptVersion,
  schemaMode: "full" | keyof typeof DROPPED_KEYWORDS = "full",
): Schema<ReceiptExtraction> {
  const wire = WIRE_SCHEMAS[version];
  if (schemaMode === "full") return zodSchema(wire);
  return jsonSchema<ReceiptExtraction>(
    async () =>
      withoutKeywords(await zodSchema(wire).jsonSchema, DROPPED_KEYWORDS[schemaMode]) as never,
    {
      validate: (value) => {
        const parsed = wire.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );
}
