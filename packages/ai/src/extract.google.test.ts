import { afterEach, describe, expect, it, vi } from "vitest";
import { extractReceipt } from "./extract";
import { OCR_MODELS } from "./models";
import { INJECTION_GUARD, PROMPT_VERSIONS } from "./prompt";
import { FIELD_DESCRIPTIONS } from "./schema";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const keys = { google: "test-key-google-shape" };

const receipt = (items: number) => ({
  merchant: "Blue Door Bistro",
  receiptDate: "2026-10-21",
  category: "Meals",
  currency: "USD",
  subtotal: 1,
  tax: 0,
  tip: null,
  total: 1,
  confidence: 0.9,
  items: Array.from({ length: items }, () => ({
    name: "x",
    quantity: 1,
    unitPrice: 1,
    totalPrice: 1,
    confidence: 0.9,
  })),
});

const answer = (extraction: unknown) =>
  Response.json({
    candidates: [
      {
        content: { role: "model", parts: [{ text: JSON.stringify(extraction) }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  });

function mockFetch(respond: () => Response) {
  const bodies: Array<{
    generationConfig: Record<string, unknown>;
    systemInstruction?: unknown;
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return respond();
    }),
  );
  return bodies;
}

afterEach(() => vi.unstubAllGlobals());

const hasKeyword = (node: unknown, keyword: string): boolean =>
  Array.isArray(node)
    ? node.some((child) => hasKeyword(child, keyword))
    : node !== null && typeof node === "object"
      ? Object.entries(node).some(([key, value]) => key === keyword || hasKeyword(value, keyword))
      : false;

describe("Gemini request shape per model", () => {
  const google = OCR_MODELS.filter((model) => model.provider === "google");

  it.each(google.map((model) => [model.id, model.schemaMode ?? "full"] as const))(
    "%s sends schema mode %s",
    async (id, mode) => {
      const bodies = mockFetch(() => answer(receipt(1)));
      await extractReceipt({
        model: id as `google:${string}`,
        file: { data: png, mediaType: "image/png" },
        keys,
        maxRetries: 0,
      });
      const config = bodies[0]!.generationConfig;
      expect(config.responseMimeType).toBe("application/json");
      expect(hasKeyword(config.responseJsonSchema, "maxItems")).toBe(mode === "full");
      // The rest of the bounds still go out.
      expect(hasKeyword(config.responseJsonSchema, "maxLength")).toBe(true);
      expect(hasKeyword(config.responseJsonSchema, "enum")).toBe(true);
    },
  );

  it.each(PROMPT_VERSIONS)("Flash-Lite drops maxItems under prompt %s too", async (version) => {
    const bodies = mockFetch(() => answer(receipt(1)));
    const result = await extractReceipt({
      model: "google:gemini-3.5-flash-lite",
      file: { data: png, mediaType: "image/png" },
      keys,
      maxRetries: 0,
      promptVersion: version,
    });
    expect(result.promptVersion).toBe(version);
    const { generationConfig, systemInstruction, contents } = bodies[0]!;
    expect(hasKeyword(generationConfig.responseJsonSchema, "maxItems")).toBe(false);
    const schema = JSON.stringify(generationConfig.responseJsonSchema);
    const parts = contents[0]!.parts.map((part) => ("inlineData" in part ? "file" : "text"));
    if (version === "v1") {
      expect(systemInstruction).toBeUndefined();
      expect(schema).not.toContain(JSON.stringify(FIELD_DESCRIPTIONS.tax));
      expect(parts).toEqual(["text", "file"]);
    } else {
      // Gemini reads the rules as its system instruction and the field definitions in the schema.
      expect(JSON.stringify(systemInstruction)).toContain(INJECTION_GUARD);
      expect(schema).toContain(JSON.stringify(FIELD_DESCRIPTIONS.tax));
      expect(parts).toEqual(["file", "text"]);
    }
  });

  it("Flash-Lite still enforces the item cap on the reply", async () => {
    mockFetch(() => answer(receipt(301)));
    await expect(
      extractReceipt({
        model: "google:gemini-3.5-flash-lite",
        file: { data: png, mediaType: "image/png" },
        keys,
        maxRetries: 0,
      }),
    ).rejects.toMatchObject({ kind: "invalid-output" });
  });

  it("Flash-Lite parses a valid reply into the full extraction", async () => {
    mockFetch(() => answer(receipt(2)));
    const { extraction } = await extractReceipt({
      model: "google:gemini-3.5-flash-lite",
      file: { data: png, mediaType: "image/png" },
      keys,
      maxRetries: 0,
    });
    expect(extraction.items).toHaveLength(2);
  });

  it("a recorded detail-less 400 is not-configured, not bad-image, and is not retried", async () => {
    const bodies = mockFetch(() =>
      Response.json(
        {
          error: {
            code: 400,
            message: "Request contains an invalid argument.",
            status: "INVALID_ARGUMENT",
          },
        },
        { status: 400 },
      ),
    );
    const error = await extractReceipt({
      model: "google:gemini-3.8-flash",
      file: { data: png, mediaType: "image/png" },
      keys,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      kind: "not-configured",
      message: "OCR call failed: not-configured (HTTP 400, invalid request)",
    });
    expect(bodies).toHaveLength(1);
  });
});

describe("a 2xx reply the SDK cannot parse", () => {
  it("is invalid-output, not bad-image, so the chain moves on", async () => {
    mockFetch(() => Response.json({ unexpected: true }));
    const error = await extractReceipt({
      model: "google:gemini-3.8-flash",
      keys,
      file: { data: png, mediaType: "image/png" },
      maxRetries: 0,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "invalid-output" });
  });
});
