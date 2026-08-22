import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { Schema } from "effect";
import { z } from "zod";
import { RECEIPT_CATEGORIES } from "./categories";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "./categories";

export const ReceiptItemSchema = Schema.Struct({
  name: Schema.String,
  quantity: Schema.Number,
  unitPrice: Schema.Number,
  totalPrice: Schema.Number,
  confidence: Schema.Number,
});

export const ReceiptExtractionSchema = Schema.Struct({
  merchant: Schema.String,
  receiptDate: Schema.NullOr(Schema.String),
  category: Schema.Literal(...RECEIPT_CATEGORIES),
  currency: Schema.String,
  subtotal: Schema.NullOr(Schema.Number),
  tax: Schema.NullOr(Schema.Number),
  tip: Schema.NullOr(Schema.Number),
  total: Schema.Number,
  confidence: Schema.Number,
  items: Schema.Array(ReceiptItemSchema),
});

export type ReceiptExtraction = Schema.Schema.Type<typeof ReceiptExtractionSchema>;

export type GeminiOcrInput = {
  apiKey: string;
  model?: string;
  imageBytes: Uint8Array;
  mimeType: string;
};

const receiptObjectSchema = z.object({
  merchant: z.string(),
  receiptDate: z.string().nullable(),
  category: z.enum(RECEIPT_CATEGORIES),
  currency: z.string().length(3).describe("ISO 4217 currency code, e.g. USD"),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  tip: z.number().nullable(),
  total: z.number(),
  confidence: z.number().min(0).max(1),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export async function extractReceiptWithGemini({
  apiKey,
  model = "gemini-3.7-flash",
  imageBytes,
  mimeType,
}: GeminiOcrInput): Promise<ReceiptExtraction> {
  const google = createGoogleGenerativeAI({ apiKey });
  // `generateObject` is deprecated in AI SDK 6 in favour of `generateText`
  // with an `output` specification.
  const { output } = await generateText({
    model: google(model),
    output: Output.object({ schema: receiptObjectSchema }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Extract this receipt into structured data.",
              "Use null for missing numeric/date fields; receiptDate must be ISO (YYYY-MM-DD) when present.",
              "currency must be an ISO 4217 code such as USD or EUR.",
              `category must be exactly one of: ${RECEIPT_CATEGORIES.join(", ")}.`,
              "Confidence values must be between 0 and 1 and reflect how legible each value was.",
            ].join(" "),
          },
          {
            type: "image",
            image: imageBytes,
            mediaType: mimeType,
          },
        ],
      },
    ],
  });

  return Schema.decodeUnknownPromise(ReceiptExtractionSchema)(output);
}
