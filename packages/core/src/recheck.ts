import type { ReceiptExtraction } from "@receipt-ocr/ai";
import { sql, type DbClient } from "@receipt-ocr/db";
import { rowHasOlderCopy } from "./duplicates";
import { storedExtraction } from "./extraction-fields";
import { isDateReason, recheckedReasons } from "./review-reasons";

/** Receipts per transaction: each one locks at most this many rows, briefly. */
export const RECHECK_BATCH = 200;

type Row = {
  id: string;
  created_at: Date | string;
  merchant: string | null;
  receipt_date: string | null;
  currency: string | null;
  subtotal: string | null;
  tax: string | null;
  tip: string | null;
  discount: string | null;
  service_charge: string | null;
  total: string | null;
  review_reasons: string[];
  raw_json: unknown;
  duplicate: boolean;
};

/**
 * The resolver's date reasons when the stored date is still the one it reads from the raw
 * extraction; null when a person changed the date, or the extraction can't be read again.
 */
function resolverDateReasons(row: Row) {
  if (!row.raw_json || typeof row.raw_json !== "object") return null;
  try {
    const uploadDay = new Date(row.created_at).toISOString().slice(0, 10);
    const read = storedExtraction(row.raw_json as ReceiptExtraction, uploadDay);
    return read.receiptDate === row.receipt_date ? read.reviewReasons.filter(isDateReason) : null;
  } catch {
    return null;
  }
}

const sameReasons = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((reason, i) => reason === b[i]);

/**
 * Recomputes `review_reasons` for up to `limit` completed receipts after `after` (by id, across
 * every workspace), from their stored fields and items, with no model call. Rows another
 * transaction holds (an edit in progress) are skipped. Writes only rows whose reasons change, and
 * never `reviewed_at` or `updated_at`, so running it again changes nothing. `last` is the cursor
 * for the next batch, null once none are left.
 */
export async function recheckBatch(
  db: Pick<DbClient, "transaction">,
  after: string | null,
  limit = RECHECK_BATCH,
): Promise<{ last: string | null; scanned: number; changed: number }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<Row>(sql`
      select r.id, r.created_at, r.merchant, r.receipt_date::text as receipt_date, r.currency,
        r.subtotal, r.tax, r.tip, r.discount, r.service_charge, r.total, r.review_reasons, r.raw_json,
        (r.duplicate_dismissed_at is null and ${rowHasOlderCopy("r")}) as duplicate
      from receipts r
      where r.status = 'completed' and (${after}::uuid is null or r.id > ${after}::uuid)
      order by r.id
      limit ${limit}
      for update of r skip locked`);
    if (rows.length === 0) return { last: null, scanned: 0, changed: 0 };
    const items = await tx.execute<{ receipt_id: string; total_price: string | null }>(
      sql`select receipt_id, total_price from receipt_items where receipt_id in (${sql.join(
        rows.map((row) => sql`${row.id}::uuid`),
        sql`, `,
      )})`,
    );
    const itemsOf = new Map<string, { total_price: string | null }[]>();
    for (const item of items.rows) {
      itemsOf.set(item.receipt_id, [...(itemsOf.get(item.receipt_id) ?? []), item]);
    }
    const changes = rows.flatMap((row) => {
      const reasons = recheckedReasons(
        row.review_reasons,
        {
          merchant: row.merchant,
          receiptDate: row.receipt_date,
          currency: row.currency,
          subtotal: row.subtotal,
          tax: row.tax,
          tip: row.tip,
          discount: row.discount,
          serviceCharge: row.service_charge,
          total: row.total,
          items: (itemsOf.get(row.id) ?? []).map((item) => ({ totalPrice: item.total_price })),
        },
        resolverDateReasons(row),
        row.duplicate,
      );
      return sameReasons(reasons, row.review_reasons) ? [] : [{ id: row.id, reasons }];
    });
    if (changes.length > 0) {
      await tx.execute(sql`
        update receipts r set review_reasons = c.reasons
        from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) as c(id uuid, reasons text[])
        where r.id = c.id`);
    }
    return { last: rows.at(-1)!.id, scanned: rows.length, changed: changes.length };
  });
}
