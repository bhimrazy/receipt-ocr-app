import "server-only";
import type { ReceiptScope } from "@receipt-ocr/core";
import { logger } from "./log";

/** One JSON line per group mutation: workspace, actor, group and counts. Never group names. */
export function logGroupEvent(event: string, scope: ReceiptScope, fields: Record<string, unknown>) {
  logger.info({
    event,
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...fields,
  });
}
