import { identifierKey, sql, type SQL } from "@receipt-ocr/db";
import { merchantKey } from "./merchant-key";

/** The columns a duplicate match reads, as SQL: a row alias's columns or bound values. */
type Bill = {
  organizationId: SQL;
  id: SQL;
  createdAt: SQL;
  merchant: SQL;
  receiptDate: SQL;
  currency: SQL;
  total: SQL;
  invoiceNumber: SQL;
  merchantTaxId: SQL;
};

export type BillValues = {
  organizationId: string;
  id: string;
  createdAt: Date;
  merchant: string | null;
  receiptDate: string | null;
  currency: string | null;
  total: string | null;
  invoiceNumber: string | null;
  merchantTaxId: string | null;
};

/** `alias`'s columns. Qualified by hand: Drizzle renders columns unqualified in a single-table select. */
const billOf = (alias: string): Bill => {
  const col = (name: string) => sql.raw(`${alias}.${name}`);
  return {
    organizationId: col("organization_id"),
    id: col("id"),
    createdAt: col("created_at"),
    merchant: col("merchant"),
    receiptDate: col("receipt_date"),
    currency: col("currency"),
    total: col("total"),
    invoiceNumber: col("invoice_number"),
    merchantTaxId: col("merchant_tax_id"),
  };
};

const billValues = (v: BillValues): Bill => ({
  organizationId: sql`${v.organizationId}::text`,
  id: sql`${v.id}::uuid`,
  createdAt: sql`${v.createdAt.toISOString()}::timestamptz`,
  merchant: sql`${v.merchant}::text`,
  receiptDate: sql`${v.receiptDate}::date`,
  currency: sql`${v.currency}::text`,
  total: sql`${v.total}::numeric`,
  invoiceNumber: sql`${v.invoiceNumber}::text`,
  merchantTaxId: sql`${v.merchantTaxId}::text`,
});

/** Bill numbers restart each fiscal year, so a bill number and tax id only match within this many days. */
const SAME_ID_WINDOW = sql.raw(`400`);
/** Undated copies of one bill are usually uploaded within days of each other. */
const UNDATED_WINDOW = sql.raw(`interval '7 days'`);

const identified = (b: Bill) =>
  sql`${b.invoiceNumber} is not null and ${b.merchantTaxId} is not null`;

const within = (a: SQL, b: SQL, window: SQL) =>
  sql`${b} between ${a} - ${window} and ${a} + ${window}`;

/**
 * When `r` and `o` look like the same bill, as alternatives that each bound `o` by an index:
 * `receipts_org_invoice_key_idx` for the identifiers, `(organization_id, receipt_date)` or
 * `(organization_id, created_at)` for the rest. Symmetric in `r` and `o`.
 *
 * - Both print a bill number and a seller tax id: those decide, within SAME_ID_WINDOW days (by
 *   receipt date, or by upload when either is undated).
 * - Otherwise: the same merchant key, total, currency and receipt date; two undated copies match
 *   when uploaded within UNDATED_WINDOW of each other.
 */
function sameBillBranches(r: Bill, o: Bill): SQL[] {
  const sameIds = sql`${identified(r)} and ${identified(o)}
    and ${identifierKey(o.invoiceNumber)} = ${identifierKey(r.invoiceNumber)}
    and ${identifierKey(o.merchantTaxId)} = ${identifierKey(r.merchantTaxId)}`;
  const sameDetails = sql`not (${identified(r)} and ${identified(o)})
    and ${o.total} = ${r.total} and ${o.currency} is not distinct from ${r.currency}
    and ${merchantKey(o.merchant)} = ${merchantKey(r.merchant)}`;
  const idDays = sql`interval '1 day' * ${SAME_ID_WINDOW}`;
  const nearby = sql`(${within(r.receiptDate, o.receiptDate, SAME_ID_WINDOW)}
    or ((${r.receiptDate} is null or ${o.receiptDate} is null) and ${within(r.createdAt, o.createdAt, idDays)}))`;
  return [
    sql`${sameIds} and ${nearby}`,
    sql`${o.receiptDate} = ${r.receiptDate} and ${sameDetails}`,
    sql`${r.receiptDate} is null and ${o.receiptDate} is null and ${within(r.createdAt, o.createdAt, UNDATED_WINDOW)} and ${sameDetails}`,
  ];
}

/** `o` was added before `r`: the older copy stays clean and the newer one is flagged. */
const addedBefore = (o: Bill, r: Bill) =>
  sql`(${o.createdAt} < ${r.createdAt} or (${o.createdAt} = ${r.createdAt} and ${o.id} < ${r.id}))`;

const candidate = (r: Bill, o: Bill) =>
  sql`${o.organizationId} = ${r.organizationId} and ${o.id} <> ${r.id} and o.status = 'completed' and ${addedBefore(o, r)}`;

function olderCopyProbe(r: Bill): SQL {
  const o = billOf("o");
  const probes = sameBillBranches(r, o).map(
    (branch) => sql`exists (select 1 from receipts o where ${candidate(r, o)} and ${branch})`,
  );
  return sql`(${sql.join(probes, sql` or `)})`;
}

/** True when a completed receipt added before `bill` in its workspace looks like the same bill. */
export const hasOlderCopy = (bill: BillValues): SQL => olderCopyProbe(billValues(bill));

/** As `hasOlderCopy`, for the receipt row aliased `alias`. */
export const rowHasOlderCopy = (alias: string): SQL => olderCopyProbe(billOf(alias));

/** The oldest completed receipt added before the row aliased `alias` that looks like the same bill. */
export const oldestCopyOf = (alias: string): SQL => {
  const r = billOf(alias);
  const o = billOf("o");
  const selects = sameBillBranches(r, o).map(
    (branch) =>
      sql`(select o.id, o.created_at from receipts o where ${candidate(r, o)} and ${branch} order by o.created_at, o.id limit 1)`,
  );
  return sql`(select c.id from (${sql.join(selects, sql` union all `)}) c order by c.created_at, c.id limit 1)`;
};

/**
 * The row aliased `alias` (not `o`) was added after `bill` in the same workspace and looks like the
 * same bill: it becomes the newer copy when the older upload finishes reading late (a retry).
 */
export const isNewerCopyOf = (bill: BillValues, alias: string): SQL => {
  const r = billValues(bill);
  const n = billOf(alias);
  return sql`${n.organizationId} = ${r.organizationId} and ${n.id} <> ${r.id} and ${addedBefore(r, n)} and (${sql.join(
    sameBillBranches(r, n),
    sql` or `,
  )})`;
};
