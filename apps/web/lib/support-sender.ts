import "server-only";
import { ReceiptRepo } from "@receipt-ocr/core";
import { Effect } from "effect";
import { annotateCaller } from "./http";
import { errorFields, logger, type WideEvent } from "./log";
import { runtime } from "./runtime";
import { getActiveScope } from "./session";

/**
 * The receipt a "Report a problem" message is about: its id only when the sender is signed in
 * and it is in their active workspace, else null, so a message never points support at another
 * workspace's receipt. Never throws.
 */
export async function senderReceipt(value: unknown, event: WideEvent): Promise<string | null> {
  if (typeof value !== "string" || value === "") return null;
  try {
    const scope = await getActiveScope();
    if (!scope) return null;
    annotateCaller(event, { scope });
    const [id] = await runtime.runPromise(
      Effect.flatMap(ReceiptRepo, (repo) => repo.matchingIds(scope, { ids: [value] }, 1)),
    );
    if (id) event.receipt_id = id;
    return id ?? null;
  } catch (error) {
    logger.error({ event: "contact.receipt_check_failed", unit: "log", error: errorFields(error) });
    return null;
  }
}
