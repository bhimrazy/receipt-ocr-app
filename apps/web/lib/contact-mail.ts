import { supportMessageEmail, type EmailContext, type SendEmailInput } from "@receipt-ocr/email";

const TOPIC_LABELS = {
  "getting-started": "Question",
  "use-case": "Plans & limits",
  feature: "Feature request",
} as const;

export function isTopic(value: string): value is keyof typeof TOPIC_LABELS {
  return value in TOPIC_LABELS;
}

/** Support-inbox message; replies go to the visitor. The subject uses a fixed label, never user text. */
export function contactEmail(
  ctx: EmailContext,
  input: { to: string; from: string; topic: keyof typeof TOPIC_LABELS; message: string },
): SendEmailInput {
  const mail = supportMessageEmail(ctx, {
    from: input.from,
    topicLabel: TOPIC_LABELS[input.topic],
    message: input.message,
  });
  return { to: input.to, replyTo: input.from, ...mail };
}
