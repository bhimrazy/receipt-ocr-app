import type { ReceiptExtraction } from "./schema";

/**
 * Deterministic stand-in for a real model, for tests, e2e and load tests:
 * no network, no key, same bytes in, same receipt out.
 */
export const FIXTURE_RECEIPTS: readonly ReceiptExtraction[] = [
  {
    merchant: "Blue Bottle Coffee",
    receiptDate: "2026-10-14",
    category: "Meals",
    currency: "USD",
    subtotal: 11.5,
    tax: 1.02,
    tip: 2,
    total: 14.52,
    confidence: 0.97,
    items: [
      { name: "Flat White", quantity: 2, unitPrice: 4.75, totalPrice: 9.5, confidence: 0.98 },
      { name: "Croissant", quantity: 1, unitPrice: 2, totalPrice: 2, confidence: 0.95 },
    ],
  },
  {
    merchant: "Office Depot",
    receiptDate: "2026-09-30",
    category: "Office",
    currency: "USD",
    subtotal: 42,
    tax: 3.47,
    tip: null,
    total: 45.47,
    confidence: 0.91,
    items: [
      { name: "Printer Paper A4", quantity: 2, unitPrice: 9.5, totalPrice: 19, confidence: 0.93 },
      { name: "Toner Cartridge", quantity: 1, unitPrice: 23, totalPrice: 23, confidence: 0.9 },
    ],
  },
  {
    merchant: "Aral Tankstelle",
    receiptDate: "2026-10-02",
    category: "Fuel",
    currency: "EUR",
    subtotal: null,
    tax: 9.58,
    tip: null,
    total: 60,
    confidence: 0.72,
    items: [{ name: "Super E10 33.9 L", quantity: 1, unitPrice: 60, totalPrice: 60, confidence: 0.7 }],
  },
];

/** Bytes containing this marker make the fixture provider fail, to exercise the failure path. */
export const FIXTURE_FAIL_MARKER = "FIXTURE_FAIL";

export class FixtureFailureError extends Error {
  override name = "FixtureFailureError";
}

function containsMarker(bytes: Uint8Array): boolean {
  const marker = new TextEncoder().encode(FIXTURE_FAIL_MARKER);
  outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    return true;
  }
  return false;
}

export function fixtureExtraction(bytes: Uint8Array): ReceiptExtraction {
  if (containsMarker(bytes)) {
    throw new FixtureFailureError("Fixture provider: simulated extraction failure");
  }
  let hash = 0;
  for (const byte of bytes) hash = (hash * 31 + byte) >>> 0;
  return structuredClone(FIXTURE_RECEIPTS[hash % FIXTURE_RECEIPTS.length]!);
}
