export const mockReceipts = [
  {
    id: "demo-1",
    merchant: "Whole Foods Market",
    receiptDate: "2026-04-25",
    total: "67.43",
    tax: "4.23",
    category: "Groceries",
    status: "completed",
    confidence: "0.96",
    items: [
      { id: "i1", name: "Organic Bananas", quantity: 1, unitPrice: "2.49", totalPrice: "2.49", confidence: "0.98" },
      { id: "i2", name: "Almond Milk", quantity: 2, unitPrice: "4.99", totalPrice: "9.98", confidence: "0.95" },
      { id: "i3", name: "Sourdough Bread", quantity: 1, unitPrice: "5.49", totalPrice: "5.49", confidence: "0.94" },
    ],
  },
  {
    id: "demo-2",
    merchant: "Shell Gas Station",
    receiptDate: "2026-04-24",
    total: "52.18",
    tax: "0.00",
    category: "Fuel",
    status: "completed",
    confidence: "0.99",
    items: [
      { id: "i4", name: "Regular Unleaded", quantity: 1, unitPrice: "48.36", totalPrice: "48.36", confidence: "0.99" },
      { id: "i5", name: "Car Wash", quantity: 1, unitPrice: "3.82", totalPrice: "3.82", confidence: "0.93" },
    ],
  },
  {
    id: "demo-3",
    merchant: "CVS Pharmacy",
    receiptDate: "2026-04-22",
    total: "34.56",
    tax: "1.82",
    category: "Supplies",
    status: "failed",
    confidence: "0",
    items: [],
  },
];

export type MockReceipt = (typeof mockReceipts)[number];
