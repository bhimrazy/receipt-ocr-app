import "server-only";
import { groupsOfReceipt, listGroups } from "@receipt-ocr/core";
import { cache } from "react";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";

/** The active workspace's groups with counts, deduplicated per request. */
export const getWorkspaceGroups = cache(async () => {
  const scope = await requireActiveScope();
  return runtime.runPromise(listGroups(scope));
});

/** The groups a receipt of the active workspace is in. */
export async function getReceiptGroups(receiptId: string) {
  const scope = await requireActiveScope();
  return runtime.runPromise(groupsOfReceipt(scope, receiptId));
}
