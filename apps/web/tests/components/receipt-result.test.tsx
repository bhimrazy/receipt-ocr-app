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
  quantity: 1,
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
    items: [item],
    ...fields,
  }) as unknown as ReceiptWithItems;

const render = (r: ReceiptWithItems) =>
  renderToStaticMarkup(<ReceiptResult canEdit receipt={r} viewerName="Test User" />);

describe("ReceiptResult", () => {
  it("marks lines whose numbers disagree until the receipt is reviewed", () => {
    const off = { ...item, totalPrice: "20.00", needsCheck: true };
    const unreviewed = render(receipt({ items: [off] }));
    expect(unreviewed).toContain("Check this line against the photo");
    expect(unreviewed).toContain("Marked lines don&#x27;t add up.");

    const reviewed = render(
      receipt({ items: [off], reviewedAt: new Date(), reviewer: { name: "Test User" } }),
    );
    expect(reviewed).not.toContain("Check this line against the photo");
    expect(reviewed).not.toContain("Marked lines don&#x27;t add up.");
    expect(reviewed).not.toContain("bg-warning/5");
  });

  it("does not mark a line that adds up, whatever the model's confidence", () => {
    const html = render(receipt());
    expect(html).not.toContain("Check this line against the photo");
    expect(html).not.toContain("Marked lines");
  });

  it("links back to Receipts and has no raw extraction block", () => {
    const html = render(receipt());
    expect(html).toContain("Receipts</a>");
    expect(html).not.toContain("Raw extraction");
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
