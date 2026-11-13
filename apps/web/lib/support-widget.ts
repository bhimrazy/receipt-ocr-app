/**
 * Lightweight bridge so any component can pop open the support widget
 * without a shared context provider.
 */
export type SupportTopic = "getting-started" | "use-case" | "feature" | "problem";

export const SUPPORT_OPEN_EVENT = "support:open";

/** `receiptId` goes with a "problem" message so support can find the receipt. */
export type SupportOpenDetail = { topic?: SupportTopic; receiptId?: string };

export function openSupportWidget(topic?: SupportTopic, context: { receiptId?: string } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SupportOpenDetail>(SUPPORT_OPEN_EVENT, {
      detail: { topic, receiptId: context.receiptId },
    }),
  );
}
