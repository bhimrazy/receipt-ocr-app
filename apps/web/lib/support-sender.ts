import "server-only";
import { annotateCaller } from "./http";
import { errorFields, logger, type WideEvent } from "./log";
import { getActiveScope } from "./session";

/**
 * The signed-in sender of a support message and their active workspace, or null for a visitor.
 * A failed session lookup also gives null: the message is still stored, just not linked.
 */
export async function supportSender(
  event: WideEvent,
): Promise<{ userId: string; organizationId: string } | null> {
  try {
    const scope = await getActiveScope();
    if (!scope) return null;
    annotateCaller(event, { scope });
    return { userId: scope.userId, organizationId: scope.organizationId };
  } catch (error) {
    logger.error({ event: "contact.sender_lookup_failed", unit: "log", error: errorFields(error) });
    return null;
  }
}
