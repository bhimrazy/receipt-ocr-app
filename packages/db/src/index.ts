import { relations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  index,
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
import {
  account,
  invitation,
  member,
  organization,
  rateLimit,
  session,
  user,
  verification,
} from "./auth-schema";

export * from "./auth-schema";
// Re-export query operators so consumers use THIS package's drizzle-orm
// instance (avoids duplicate-instance type conflicts under pnpm).
export { and, asc, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

export const receiptStatus = pgEnum("receipt_status", [
  "uploaded",
  "processing",
  "completed",
  "failed",
]);

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
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
    // Which storage credentials the image was written with: "managed" | "byok".
    storageSource: text("storage_source").notNull().default("managed"),
    rawJson: jsonb("raw_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("receipts_user_id_idx").on(table.userId)],
);

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

/**
 * User-provided BYOK credentials. The secret is AES-256-GCM encrypted with
 * the server master key; only metadata (label, last4, status) is ever
 * returned to clients.
 */
export const userCredentials = pgTable(
  "user_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "gemini" | "s3"
    label: text("label"),
    last4: text("last4").notNull(),
    ciphertext: text("ciphertext").notNull(), // base64(nonce ‖ ct ‖ tag)
    status: text("status").notNull().default("active"), // active | invalid | revoked
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("user_credentials_user_id_idx").on(table.userId)],
);

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
  userCredentials,
  receiptsRelations,
  receiptItemsRelations,
  // Better Auth tables (core + organization + admin plugins).
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
  rateLimit,
};

/**
 * One pool per connection string, per process.
 *
 * `createDb` used to open a fresh postgres-js pool on every call, and it is
 * called from inside `ReceiptRepositoryLive` — an Effect Layer that is rebuilt
 * on every `Effect.provide(AppLive)`, i.e. on every request. That opened a new
 * pool per request and exhausted Postgres/pooler connections under load.
 * Memoizing here keeps every caller (auth, admin, the Effect layer) on a
 * single shared pool without any of them having to remember to cache.
 */
const pools = new Map<string, ReturnType<typeof drizzle<typeof schema>>>();

/** Max pooled connections per process. Keep this low on serverless. */
const MAX_CONNECTIONS = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10) || 5;

export function createDb(databaseUrl: string) {
  const cached = pools.get(databaseUrl);
  if (cached) return cached;

  const client = postgres(databaseUrl, {
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
    max: MAX_CONNECTIONS,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client, { schema });
  pools.set(databaseUrl, db);
  return db;
}

export type DbClient = ReturnType<typeof createDb>;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type ReceiptItem = typeof receiptItems.$inferSelect;
export type NewReceiptItem = typeof receiptItems.$inferInsert;
export type UserCredential = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
