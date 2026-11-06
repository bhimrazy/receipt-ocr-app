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
// instance (avoids duplicate-instance type conflicts with isolated installs).
export {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

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
    /** The workspace that owns this receipt. Every member of it can read it. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /**
     * Who uploaded it. Kept for attribution — it does NOT scope visibility.
     * Null once that user is deleted: the receipt stays with its workspace.
     */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
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
    /** Original upload name; kept outside raw_json, which extraction overwrites. */
    fileName: text("file_name"),
    imageObjectKey: text("image_object_key"),
    // Which storage credentials the image was written with: "managed" | "byok".
    storageSource: text("storage_source").notNull().default("managed"),
    rawJson: jsonb("raw_json"),
    errorMessage: text("error_message"),
    /** Extraction attempts so far (1 = the upload itself); retries are capped on this. */
    attempts: integer("attempts").notNull().default(1),
    /** When the latest retry started; quota windows count it like a new upload. */
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    /** `provider:model` that produced the extraction; null until one has. */
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves the per-user quota count over a time window.
    index("receipts_user_created_at_idx").on(table.userId, table.createdAt),
    // Serves the global daily OCR cap.
    index("receipts_created_at_idx").on(table.createdAt),
    // History lists a workspace newest-first; this index serves that directly.
    index("receipts_org_created_at_idx").on(table.organizationId, table.createdAt),
    // Lets the quota query BitmapOr retries in with created_at instead of scanning.
    index("receipts_last_attempt_at_idx").on(table.lastAttemptAt),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
  },
  // Loading a receipt's items and the cascade delete both look up by receipt.
  (table) => [index("receipt_items_receipt_id_idx").on(table.receiptId)],
);

/**
 * Reserved for user-provided BYOK credentials. Nothing reads or writes this
 * table yet, and no encryption for `ciphertext` exists: implement it (see
 * docs/byok-key-management.md) before storing any secret here.
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

/**
 * One row per admin action: who did what to which target, and why. Actor and
 * target are snapshots (email, label) so entries still read after a deletion.
 */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorEmail: text("actor_email").notNull(),
    /** Dotted verb, e.g. `user.ban`, `workspace.delete`, `settings.plans`. */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(), // user | workspace | settings
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_at_idx").on(table.createdAt),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId, table.createdAt),
  ],
);

/** Runtime settings an admin can change (`plans`, `ocr`). Values are validated on read and write. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
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
  userCredentials,
  adminAuditLog,
  appSettings,
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
 * One pool per connection string, per process, shared by auth, admin and the
 * Effect runtime. A pool per caller would exhaust the Supabase pooler.
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
export type AdminAuditEntry = typeof adminAuditLog.$inferSelect;
export type UserCredential = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
