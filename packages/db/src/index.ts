import { relations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import postgres from "postgres";

export const receiptStatus = pgEnum("receipt_status", [
  "uploaded",
  "processing",
  "completed",
  "failed",
]);

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  merchant: text("merchant"),
  receiptDate: text("receipt_date"),
  category: text("category"),
  currency: text("currency").default("USD"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }),
  tax: numeric("tax", { precision: 12, scale: 2 }),
  tip: numeric("tip", { precision: 12, scale: 2 }),
  total: numeric("total", { precision: 12, scale: 2 }),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  status: receiptStatus("status").notNull().default("uploaded"),
  imageObjectKey: text("image_object_key"),
  rawJson: jsonb("raw_json"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receiptItems = pgTable("receipt_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => receipts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
});

export const receiptsRelations = relations(receipts, ({ many }) => ({
  items: many(receiptItems),
}));

export const receiptItemsRelations = relations(receiptItems, ({ one }) => ({
  receipt: one(receipts, {
    fields: [receiptItems.receiptId],
    references: [receipts.id],
  }),
}));

export const schema = {
  receiptStatus,
  receipts,
  receiptItems,
  receiptsRelations,
  receiptItemsRelations,
};

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}

export type DbClient = ReturnType<typeof createDb>;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptItem = typeof receiptItems.$inferSelect;
export type NewReceiptItem = typeof receiptItems.$inferInsert;
