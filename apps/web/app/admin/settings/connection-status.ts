import type { ConnectionStatus } from "@receipt-ocr/core";

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  ok: "Working",
  "invalid-key": "Key rejected",
  "no-billing-or-quota": "Billing or quota",
  "rate-limited": "Rate limited",
  unreachable: "Unreachable",
  "model-not-available": "Model missing",
  "not-configured": "Not set up",
  failed: "Failed",
};

export function statusTone(
  status: ConnectionStatus,
): "success" | "warning" | "destructive" | "outline" {
  if (status === "ok") return "success";
  if (status === "not-configured") return "outline";
  if (status === "rate-limited" || status === "unreachable") return "warning";
  return "destructive";
}

export function testEmailMessage(outcome: "sent" | "not-configured" | "failed") {
  switch (outcome) {
    case "sent":
      return { ok: true, text: "Sent. Check your inbox." };
    case "not-configured":
      return { ok: false, text: "Email isn't set up. Set RESEND_API_KEY and EMAIL_FROM." };
    default:
      return { ok: false, text: "The email provider refused the message. Check its dashboard." };
  }
}
