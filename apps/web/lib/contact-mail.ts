import type { SendEmailInput } from "@receipt-ocr/email";

const TOPIC_LABELS = {
  "getting-started": "Question",
  "use-case": "Plans & limits",
  feature: "Feature request",
} as const;

export function isTopic(value: string): value is keyof typeof TOPIC_LABELS {
  return value in TOPIC_LABELS;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Support-inbox message; replies go to the visitor. The subject uses a fixed label, never user text. */
export function contactEmail(input: {
  to: string;
  from: string;
  topic: keyof typeof TOPIC_LABELS;
  message: string;
}): SendEmailInput {
  const label = TOPIC_LABELS[input.topic];
  return {
    to: input.to,
    replyTo: input.from,
    subject: `[receiptOCR support] ${label}`,
    text: `${label} from ${input.from}\n\n${input.message}`,
    html: `<p><strong>${label}</strong> from ${escapeHtml(input.from)}</p><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>`,
  };
}
