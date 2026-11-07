import "server-only";
import {
  parseSpendSearch,
  resolveRange,
  spendDashboard,
  localDate,
  isTimeZone,
  type SpendDashboard,
  type SpendSearch,
} from "@receipt-ocr/core";
import { cookies } from "next/headers";
import { cache } from "react";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";
import { TIME_ZONE_COOKIE } from "./time-zone-cookie";

/** The viewer's zone from the cookie when it is a real one, else UTC (first visit, bots). */
export function viewerTimeZone(value: string | undefined) {
  return value && value.length <= 64 && isTimeZone(value) ? value : "UTC";
}

export type SpendView = { search: SpendSearch; dashboard: SpendDashboard };

/**
 * The Home dashboard for the active workspace, once per request: a single
 * statement over the last 12 months to two years of completed receipts.
 * Keyed by the search string so equal params share one query.
 */
const load = cache(async (zone: string, key: string): Promise<SpendView> => {
  const search = parseSpendSearch(Object.fromEntries(new URLSearchParams(key)));
  const scope = await requireActiveScope();
  const today = localDate(new Date(), zone);
  const dashboard = await runtime.runPromise(
    spendDashboard(scope, { range: resolveRange(search, today), today, timeZone: zone }),
  );
  return { search, dashboard };
});

export async function getSpendView(params: Record<string, string | string[] | undefined>) {
  const search = parseSpendSearch(params);
  const key = new URLSearchParams(
    Object.entries(search).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();
  const zone = viewerTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return load(zone, key);
}
