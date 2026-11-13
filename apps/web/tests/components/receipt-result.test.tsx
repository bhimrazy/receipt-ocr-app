import type { ReceiptWithItems } from "@receipt-ocr/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/app/receipts/r1",
}));

const { ReceiptResult } = await import("@/components/receipt-result");

const item = {
  id: "i1",
  receiptId: "r1",
  name: "Smudged item",
  quantity: "1",
  unitPrice: "10.00",
  totalPrice: "10.00",
  confidence: "0.5000",
  position: 0,
};

const receipt = (fields: Partial<ReceiptWithItems> = {}) =>
  ({
    id: "r1",
    status: "completed",
    merchant: "Test Shop",
    receiptDate: "2026-10-01",
    receiptDateCalendar: null,
    category: "Groceries",
    currency: "USD",
    total: "10.80",
    subtotal: null,
    tax: null,
    tip: null,
    discount: null,
    serviceCharge: null,
    invoiceNumber: null,
    merchantTaxId: null,
    reviewReasons: ["no_date"],
    reviewedAt: null,
    reviewer: null,
    attempts: 1,
    createdAt: new Date("2026-10-01T12:00:00Z"),
    imageObjectKey: "r1.jpg",
    rawJson: null,
    items: [item],
    ...fields,
  }) as unknown as ReceiptWithItems;

const render = (r: ReceiptWithItems) =>
  renderToStaticMarkup(<ReceiptResult canEdit receipt={r} viewerName="Test User" />);

describe("ReceiptResult", () => {
  it("marks hard-to-read lines until the receipt is reviewed", () => {
    const unreviewed = render(receipt());
    expect(unreviewed).toContain("Check this line against the photo");
    expect(unreviewed).toContain("Marked lines were hard to read.");

    const reviewed = render(receipt({ reviewedAt: new Date(), reviewer: { name: "Test User" } }));
    expect(reviewed).not.toContain("Check this line against the photo");
    expect(reviewed).not.toContain("Marked lines were hard to read.");
    expect(reviewed).not.toContain("bg-warning/5");
  });

  it("shows only the optional fields the receipt has", () => {
    const sparse = render(receipt());
    for (const label of ["Merchant", "Date", "Category", "Currency", "Total"])
      expect(sparse).toContain(`>${label}<`);
    for (const label of ["Subtotal", "Tax", "Tip", "Discount", "Service charge", "Bill number"])
      expect(sparse).not.toContain(`>${label}<`);

    const full = render(receipt({ subtotal: "10.00", tax: "0.80", invoiceNumber: "INV-1" }));
    for (const label of ["Subtotal", "Tax", "Bill number"]) expect(full).toContain(`>${label}<`);
    expect(full).not.toContain(">Tip<");
  });
});
