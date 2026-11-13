import { describe, expect, it } from "vitest";
import { FIXTURE_RECEIPTS } from "../src/fixture";
import { receiptExtractionSchema, receiptRequestSchema } from "../src/schema";

const v3Reply = {
  merchant: null,
  receiptDate: null,
  dates: [
    { text: "मिति: ०९/०४/२०८०", label: "मिति", calendar: "bikram-sambat", role: "transaction" },
  ],
  invoiceNumber: "SI-0042-81/82",
  merchantTaxId: "999000001",
  category: "Meals",
  currency: null,
  subtotal: 595,
  discount: null,
  serviceCharge: 59.5,
  tax: 85.09,
  tip: null,
  total: null,
  confidence: 0.6,
  items: [],
};

const v2Reply = Object.fromEntries(
  Object.entries(FIXTURE_RECEIPTS[0]!).filter(
    ([key]) =>
      !["dates", "invoiceNumber", "merchantTaxId", "discount", "serviceCharge"].includes(key),
  ),
);

async function validate(version: "v2" | "v3", value: unknown, mode?: "no-bounds") {
  const schema = receiptRequestSchema(version, mode);
  return (await schema.validate!(value)).success;
}

describe("extraction schema v3", () => {
  it("lets merchant, total and currency be null instead of invented", () => {
    expect(receiptExtractionSchema.safeParse(v3Reply).success).toBe(true);
  });

  it("keeps Devanagari dates as printed", () => {
    const parsed = receiptExtractionSchema.parse(v3Reply);
    expect(parsed.dates[0]!.text).toBe("मिति: ०९/०४/२०८०");
  });

  it("caps dates at 4 and rejects a calendar outside the two it knows", () => {
    const date = v3Reply.dates[0]!;
    expect(
      receiptExtractionSchema.safeParse({ ...v3Reply, dates: Array(5).fill(date) }).success,
    ).toBe(false);
    expect(
      receiptExtractionSchema.safeParse({ ...v3Reply, dates: [{ ...date, calendar: "bs" }] })
        .success,
    ).toBe(false);
  });

  it("requires every v3 field, so a reply missing one fails validation", async () => {
    expect(await validate("v3", v2Reply)).toBe(false);
    expect(await validate("v3", v3Reply)).toBe(true);
  });

  it("checks a no-bounds reply against its own version's full schema", async () => {
    const tooMany = { ...v3Reply, dates: Array(5).fill(v3Reply.dates[0]) };
    expect(await validate("v3", tooMany, "no-bounds")).toBe(false);
    expect(await validate("v2", v2Reply, "no-bounds")).toBe(true);
  });
});

describe("extraction schema v2, kept for the A/B", () => {
  it("is unchanged: no v3 fields, and merchant, total and currency still required", async () => {
    const wire = (await receiptRequestSchema("v2").jsonSchema) as { properties: object };
    expect(Object.keys(wire.properties)).toEqual([
      "merchant",
      "receiptDate",
      "category",
      "currency",
      "subtotal",
      "tax",
      "tip",
      "total",
      "confidence",
      "items",
    ]);
    expect(await validate("v2", v2Reply)).toBe(true);
    expect(await validate("v2", { ...v2Reply, merchant: null })).toBe(false);
  });
});
