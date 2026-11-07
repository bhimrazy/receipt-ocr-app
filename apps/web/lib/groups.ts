import "server-only";
import { groupsOfReceipt, listGroups } from "@receipt-ocr/core";
import { Cause, Exit, Option } from "effect";
import { cache } from "react";
import { runtime } from "./runtime";
import { requireActiveScope } from "./session";

/** The active workspace's groups with counts, deduplicated per request. */
export const getWorkspaceGroups = cache(async () => {
  const scope = await requireActiveScope();
  return runtime.runPromise(listGroups(scope));
});

/** The groups a receipt of the active workspace is in; empty when it isn't this workspace's. */
export async function getReceiptGroups(receiptId: string) {
  const scope = await requireActiveScope();
  const exit = await runtime.runPromiseExit(groupsOfReceipt(scope, receiptId));
  if (Exit.isSuccess(exit)) return exit.value;
  // A missing receipt is the page's 404 to raise; anything else is a real error.
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure) && failure.value._tag === "NotFound") return [];
  throw Cause.squash(exit.cause);
}
