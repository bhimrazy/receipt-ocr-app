import { SupportWidgetClient } from "@/components/support-widget-client";
import { supportEmail } from "@/lib/env";

/** Server wrapper: the client widget needs the support address only for its load-failure fallback. */
export function SupportWidget({ launcher }: { launcher?: boolean }) {
  return <SupportWidgetClient email={supportEmail} launcher={launcher} />;
}
