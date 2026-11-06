import "server-only";
import {
  parseSpendSearch,
  resolveRange,
  spendDashboard,
  localDate,
  type SpendDashboard,
  type SpendSearch,
} from "@receipt-ocr/core";
import { cache } from "react";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";

/** Days are UTC until users can pick a time zone (the quota's day is UTC too). */
const TIME_ZONE = "UTC";

export type SpendView = { search: SpendSearch; dashboard: SpendDashboard };

/**
 * The Home dashboard for the active workspace, once per request: a single
 * statement over the last 12 months to two years of completed receipts.
 * Keyed by the search string so equal params share one query.
 */
const load = cache(async (key: string): Promise<SpendView> => {
  const search = parseSpendSearch(Object.fromEntries(new URLSearchParams(key)));
  const scope = await requireActiveScope();
  const today = localDate(new Date(), TIME_ZONE);
  const dashboard = await runtime.runPromise(
    spendDashboard(scope, { range: resolveRange(search, today), today, timeZone: TIME_ZONE }),
  );
  return { search, dashboard };
});

export function getSpendView(params: Record<string, string | string[] | undefined>) {
  const search = parseSpendSearch(params);
  const key = new URLSearchParams(
    Object.entries(search).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  return load(key);
}
