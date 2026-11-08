/**
 * Lightweight bridge so any component can pop open the support widget
 * without a shared context provider.
 */
export type SupportTopic = "getting-started" | "use-case" | "feature";

export const SUPPORT_OPEN_EVENT = "support:open";

export type SupportOpenDetail = { topic?: SupportTopic };

export function openSupportWidget(topic?: SupportTopic) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SupportOpenDetail>(SUPPORT_OPEN_EVENT, { detail: { topic } }),
  );
}
