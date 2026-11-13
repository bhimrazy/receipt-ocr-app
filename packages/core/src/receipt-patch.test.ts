import { describe, expect, it } from "vitest";
import { parseAmount, parseReceiptPatch } from "./receipt-patch";

describe("parseAmount", () => {
  it.each([
    ["12.50", "12.50"],
    ["12.5", "12.50"],
    ["12,50", "12.50"],
    ["12,5", "12.50"],
    ["1,234", "1234.00"],
    ["1,234.56", "1234.56"],
    ["1,234,567", "1234567.00"],
    ["1,23,456.50", "123456.50"],
    ["1 234.50", "1234.50"],
    ["€5", "5.00"],
    ["$ 12.00", "12.00"],
    ["५००", "500.00"],
    ["-3", "-3.00"],
    ["0", "0.00"],
    ["-0", "0.00"],
    ["007.10", "7.10"],
    [12.5, "12.50"],
    [0.1 + 0.2, "0.30"],
    [1234, "1234.00"],
    [9_999_999_999.99, "9999999999.99"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseAmount(input)).toEqual({ value: expected });
  });

  it.each([null, undefined, "", "  "])("reads %s as empty", (input) => {
    expect(parseAmount(input)).toEqual({ value: null });
  });

  it.each([
    // A dot is always the decimal mark: three decimals are an error, never thousands.
    "1.234",
    "0.125",
    "12.500",
    "1.234.567",
    "1.234,56",
    "abc",
    "1e12",
    "12.",
    ",50",
    "1,2345",
    "1,234.567",
    "12,34,5",
    "1'234.50",
    "Rs 500",
    "5-",
    "--5",
    1.234,
    Number.NaN,
    true,
    {},
  ])("refuses %s", (input) => {
    expect(parseAmount(input)).toEqual({ error: "invalid" });
  });

  it("refuses an amount the column can't hold, and a negative one where it is not allowed", () => {
    expect(parseAmount("12345678901")).toEqual({ error: "too large" });
    expect(parseAmount(1e12)).toEqual({ error: "too large" });
    expect(parseAmount("-5", { negative: false })).toEqual({ error: "negative" });
  });
});

describe("parseReceiptPatch", () => {
  it("parses every editable field", () => {
    expect(
      parseReceiptPatch({
        merchant: "  Test Shop ",
        receiptDate: "2026-01-31",
        receiptDateCalendar: "bikram-sambat",
        category: "meals",
        currency: "npr",
        invoiceNumber: "SI-0042-81/82",
        merchantTaxId: "",
        subtotal: "1,000.00",
        tax: "130",
        tip: null,
        discount: "50,00",
        serviceCharge: "100",
        total: "1180",
      }),
    ).toEqual({
      patch: {
        merchant: "Test Shop",
        receiptDate: "2026-01-31",
        receiptDateCalendar: "bikram-sambat",
        category: "Meals",
        currency: "NPR",
        invoiceNumber: "SI-0042-81/82",
        merchantTaxId: null,
        subtotal: "1000.00",
        tax: "130.00",
        tip: null,
        discount: "50.00",
        serviceCharge: "100.00",
        total: "1180.00",
      },
    });
  });

  it("leaves out fields that weren't sent", () => {
    expect(parseReceiptPatch({ total: "12,50" })).toEqual({ patch: { total: "12.50" } });
    expect(parseReceiptPatch({})).toEqual({ patch: {} });
  });

  it.each<[unknown, string]>([
    [{ total: "abc" }, "Total must be an amount, like 12.50."],
    [{ subtotal: "€5x" }, "Subtotal must be an amount, like 12.50."],
    [{ discount: "-5" }, "Discount can't be negative."],
    [{ serviceCharge: "-1" }, "Service charge can't be negative."],
    [{ total: "1e12" }, "Total must be an amount, like 12.50."],
    [{ currency: "EURO" }, "Currency must be a 3-letter code, like USD."],
    [{ currency: "US$" }, "Currency must be a 3-letter code, like USD."],
    [{ category: "Bribes" }, "Unknown category."],
    [{ receiptDate: "2026-02-30" }, "Enter a real date from 2000 on, as YYYY-MM-DD."],
    [{ receiptDate: "31/01/2026" }, "Enter a real date from 2000 on, as YYYY-MM-DD."],
    [{ receiptDateCalendar: "bs" }, "The calendar must be gregory or bikram-sambat."],
    [{ merchant: "x".repeat(201) }, "Merchant can be at most 200 characters."],
    [{ invoiceNumber: "x".repeat(65) }, "Bill number can be at most 64 characters."],
    [{ merchantTaxId: 123456789 }, "Tax ID must be text."],
    [{ status: "completed" }, "Unknown field: status"],
    [[1], "Send the changes as a JSON object."],
  ])("refuses %j: %s", (body, error) => {
    expect(parseReceiptPatch(body)).toEqual({ error });
  });
});
