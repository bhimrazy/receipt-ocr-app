import { z } from "zod";
import { RECEIPT_CATEGORIES } from "./categories";

const confidence = z.number().min(0).max(1);

/** The single source of truth for an extraction: validated by the AI SDK, typed via `z.infer`. */
export const receiptExtractionSchema = z.object({
  merchant: z.string(),
  receiptDate: z.string().nullable(),
  category: z.enum(RECEIPT_CATEGORIES),
  currency: z.string().length(3).describe("ISO 4217 currency code, e.g. USD"),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number(),
  confidence,
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
      confidence,
    }),
  ),
});

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;
