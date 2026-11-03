/**
 * The one canonical list of receipt categories: extraction, editing, filters
 * and the backfill migration all use it.
 *
 * A dependency-free leaf with its own package export
 * (`@receipt-ocr/ai/categories`) so client components can import it without
 * pulling the AI SDK into the browser bundle.
 */
export const RECEIPT_CATEGORIES = [
  "Meals",
  "Groceries",
  "Travel",
  "Fuel",
  "Office",
  "Software",
  "Equipment",
  "Supplies",
  "Utilities",
  "Services",
  "Fees",
  "Other",
] as const;

export type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];

/** What each category covers; fed to the model so it picks consistently. */
export const CATEGORY_DESCRIPTIONS: Record<ReceiptCategory, string> = {
  Meals: "restaurants, cafes, takeaway, bars, client meals",
  Groceries: "supermarkets and food stores",
  Travel: "flights, hotels, taxis, rideshare, trains, parking, tolls",
  Fuel: "petrol, diesel, EV charging",
  Office: "stationery, printing, postage, office rent",
  Software: "apps, SaaS subscriptions, hosting, domains",
  Equipment: "computers, phones, hardware, tools, furniture",
  Supplies: "general retail goods, materials, pharmacy",
  Utilities: "electricity, water, internet, phone bills",
  Services: "professional services, contractors, repairs, cleaning",
  Fees: "bank and payment fees, licences, memberships, government fees",
  Other: "anything that fits none of the above",
};

/**
 * Older values (the previous consumer list and free-text categories already
 * stored in rows) mapped onto the canonical list. Keys are lowercase.
 * `apps/web/drizzle/0004_canonical_categories.sql` must stay in sync; a test
 * checks it.
 */
const SYNONYMS: Record<string, ReceiptCategory> = {
  grocery: "Groceries",
  supermarket: "Groceries",
  food: "Groceries",
  restaurant: "Meals",
  restaurants: "Meals",
  dining: "Meals",
  meal: "Meals",
  "food & drink": "Meals",
  coffee: "Meals",
  cafe: "Meals",
  gas: "Fuel",
  petrol: "Fuel",
  transport: "Travel",
  transportation: "Travel",
  taxi: "Travel",
  lodging: "Travel",
  hotel: "Travel",
  "office supplies": "Office",
  stationery: "Office",
  subscription: "Software",
  subscriptions: "Software",
  electronics: "Equipment",
  hardware: "Equipment",
  shopping: "Supplies",
  retail: "Supplies",
  pharmacy: "Supplies",
  utility: "Utilities",
  service: "Services",
  fee: "Fees",
  entertainment: "Other",
  miscellaneous: "Other",
};

const BY_LOWERCASE = new Map<string, ReceiptCategory>([
  ...RECEIPT_CATEGORIES.map((category) => [category.toLowerCase(), category] as const),
  ...Object.entries(SYNONYMS),
]);

/** The canonical category for `value`, or undefined when it is not recognised. */
export function parseCategory(value: string | null | undefined): ReceiptCategory | undefined {
  if (!value) return undefined;
  return BY_LOWERCASE.get(value.trim().toLowerCase());
}

/** Canonical category for anything stored; unrecognised text becomes "Other". */
export function normalizeCategory(value: string | null | undefined): ReceiptCategory | null {
  if (!value?.trim()) return null;
  return parseCategory(value) ?? "Other";
}

export function isReceiptCategory(value: unknown): value is ReceiptCategory {
  return typeof value === "string" && (RECEIPT_CATEGORIES as readonly string[]).includes(value);
}
