import { jsonSchema, zodSchema, type Schema } from "ai";
import { z } from "zod";
import { RECEIPT_CATEGORIES } from "./categories";

const confidence = z.number().min(0).max(1);

// Length caps bound what a crafted image can make the model emit (cost, stored rows).
/** The single source of truth for an extraction: validated by the AI SDK, typed via `z.infer`. */
export const receiptExtractionSchema = z.object({
  merchant: z.string().max(200),
  receiptDate: z.string().max(32).nullable(),
  category: z.enum(RECEIPT_CATEGORIES),
  currency: z.string().length(3).describe("ISO 4217 currency code, e.g. USD"),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number(),
  confidence,
  items: z
    .array(
      z.object({
        name: z.string().max(300),
        quantity: z.number(),
        unitPrice: z.number(),
        totalPrice: z.number(),
        confidence,
      }),
    )
    .max(300),
});

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
 * The schema sent to the model, for a model whose `schemaMode` is "no-array-bounds": the same
 * JSON schema minus `maxItems`, still validated against `receiptExtractionSchema` on the reply.
 */
export function receiptRequestSchema(): Schema<ReceiptExtraction> {
  return jsonSchema<ReceiptExtraction>(
    async () =>
      withoutKeyword(await zodSchema(receiptExtractionSchema).jsonSchema, "maxItems") as never,
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
