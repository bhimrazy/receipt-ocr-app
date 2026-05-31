import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { Schema } from "effect";
import { z } from "zod";

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
  category: Schema.String,
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
  category: z.string(),
  currency: z.string(),
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
  model = "gemini-2.5-flash",
  imageBytes,
  mimeType,
}: GeminiOcrInput): Promise<ReceiptExtraction> {
  const google = createGoogleGenerativeAI({ apiKey });
  const { object } = await generateObject({
    model: google(model),
    schema: receiptObjectSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract this receipt into structured data. Use null for missing numeric/date fields. Confidence values must be between 0 and 1.",
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

  return Schema.decodeUnknownPromise(ReceiptExtractionSchema)(object);
}
