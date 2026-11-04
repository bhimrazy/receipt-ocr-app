import type { ReceiptCategory } from "@receipt-ocr/ai/categories";

/*
 * Scripted sample receipts for the hero demo. Fields mirror the extraction schema
 * (packages/ai/src/schema.ts): confidence exists per receipt and per item only, never per field.
 * Every receipt adds up: items = subtotal, subtotal + tax + tip = total.
 */

export type SampleItem = {
  name: string;
  /** As printed on the paper. */
  printed: string;
  quantity: number;
  totalPrice: number;
  confidence: number;
};

export type Sample = {
  id: "coffee" | "hardware" | "dinner";
  label: string;
  fileName: string;
  merchant: string;
  /** Header lines printed under the merchant name. */
  address: string[];
  receiptDate: string;
  time: string;
  category: ReceiptCategory;
  currency: "USD";
  items: SampleItem[];
  subtotal: number;
  tax: number;
  tip: number | null;
  /** Tip written by hand on the paper. */
  handwrittenTip?: boolean;
  total: number;
  confidence: number;
  footer: string;
};

export const samples: Sample[] = [
  {
    id: "coffee",
    label: "Coffee",
    fileName: "IMG_2041.jpg",
    merchant: "Bluebird Café",
    address: ["412 Larch St", "Portland, OR"],
    receiptDate: "2026-10-26",
    time: "08:12",
    category: "Meals",
    currency: "USD",
    items: [
      {
        name: "Oat flat white",
        printed: "OAT FLAT WHITE",
        quantity: 1,
        totalPrice: 4.75,
        confidence: 0.98,
      },
      {
        name: "Almond croissant",
        printed: "ALMOND CROISS",
        quantity: 1,
        totalPrice: 4.25,
        confidence: 0.95,
      },
      {
        name: "Cold brew 16oz",
        printed: "COLD BREW 16",
        quantity: 1,
        totalPrice: 5.5,
        confidence: 0.93,
      },
    ],
    subtotal: 14.5,
    tax: 1.29,
    tip: 2,
    total: 17.79,
    confidence: 0.96,
    footer: "THANK YOU, SEE YOU TOMORROW",
  },
  {
    id: "hardware",
    label: "Hardware",
    fileName: "scan-0193.png",
    merchant: "Hartley Hardware",
    address: ["88 Mill Rd", "Ashford, CT"],
    receiptDate: "2026-10-24",
    time: "16:47",
    category: "Equipment",
    currency: "USD",
    items: [
      {
        name: "Cordless drill 18V",
        printed: "DRILL CRDLS 18V",
        quantity: 1,
        totalPrice: 89,
        confidence: 0.97,
      },
      {
        name: "Drill bit set",
        printed: "BIT SET 21PC",
        quantity: 1,
        totalPrice: 19.99,
        confidence: 0.94,
      },
      {
        name: "Wood screws",
        printed: "WD SCREW #8 x4",
        quantity: 4,
        totalPrice: 7,
        confidence: 0.91,
      },
      {
        name: "Masking tape",
        printed: "MSK TAPE 2IN x2",
        quantity: 2,
        totalPrice: 6.98,
        confidence: 0.64,
      },
    ],
    subtotal: 122.97,
    tax: 10.15,
    tip: null,
    total: 133.12,
    confidence: 0.84,
    footer: "RETURNS WITHIN 30 DAYS",
  },
  {
    id: "dinner",
    label: "Dinner + tip",
    fileName: "dinner-friday.heic",
    merchant: "Osteria Lume",
    address: ["19 Harbor Ave", "Boston, MA"],
    receiptDate: "2026-10-22",
    time: "21:30",
    category: "Meals",
    currency: "USD",
    items: [
      { name: "Burrata", printed: "BURRATA", quantity: 1, totalPrice: 14, confidence: 0.97 },
      {
        name: "Cacio e pepe",
        printed: "CACIO E PEPE x2",
        quantity: 2,
        totalPrice: 38,
        confidence: 0.96,
      },
      { name: "Branzino", printed: "BRANZINO", quantity: 1, totalPrice: 31, confidence: 0.95 },
      {
        name: "House red, glass",
        printed: "HSE RED GL x2",
        quantity: 2,
        totalPrice: 24,
        confidence: 0.9,
      },
    ],
    subtotal: 107,
    tax: 9.5,
    tip: 21.4,
    handwrittenTip: true,
    total: 137.9,
    confidence: 0.91,
    footer: "GRAZIE · TABLE 7",
  },
];

/** Rows already in the sample workspace, below whatever the demo adds. */
export const earlierRows = [
  {
    merchant: "Metro Transit",
    receiptDate: "2026-10-20",
    category: "Travel",
    tax: 0,
    tip: null,
    total: 45,
  },
  {
    merchant: "Fiber Net",
    receiptDate: "2026-10-18",
    category: "Utilities",
    tax: 6.4,
    tip: null,
    total: 79.99,
  },
] as const;

/** The reveal order for one run; the paper highlights the line each step reads. */
export function stepsFor(sample: Sample): string[] {
  return [
    "merchant",
    "date",
    ...sample.items.map((_, i) => `item-${i}`),
    "subtotal",
    "tax",
    ...(sample.tip === null ? [] : ["tip"]),
    "total",
    "category",
    "row",
  ];
}
