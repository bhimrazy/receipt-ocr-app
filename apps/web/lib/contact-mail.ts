import type { SupportKind } from "@receipt-ocr/core";
import { supportMessageEmail, type EmailContext, type SendEmailInput } from "@receipt-ocr/email";

/** The support form's topics and the message kind each one is stored as. */
const TOPIC_KINDS = {
  "getting-started": "question",
  "use-case": "sales",
  feature: "feedback",
  problem: "problem",
} as const satisfies Record<string, SupportKind>;

type Topic = keyof typeof TOPIC_KINDS;

const KIND_LABELS: Record<SupportKind, string> = {
  question: "Question",
  sales: "Plans & limits",
  feedback: "Feature request",
  problem: "Problem report",
};

/** How the auto-reply names the topic: "We've received {phrase}". */
const TOPIC_PHRASES: Record<Topic, string> = {
  "getting-started": "your question",
  "use-case": "your question about plans and limits",
  feature: "your feature request",
  problem: "your problem report",
};

export function isTopic(value: string): value is Topic {
  return value in TOPIC_KINDS;
}

export const topicKind = (topic: Topic): SupportKind => TOPIC_KINDS[topic];

export const topicPhrase = (topic: string) =>
  isTopic(topic) ? TOPIC_PHRASES[topic] : TOPIC_PHRASES["getting-started"];

/**
 * Support-inbox message; replies go to the sender. The subject uses a fixed label, never user
 * text. A receipt id is one the sender's workspace holds, linked so support can open it.
 */
export function contactEmail(
  ctx: EmailContext,
  input: {
    to: string;
    name: string;
    from: string;
    kind: SupportKind;
    message: string;
    receiptId: string | null;
  },
): SendEmailInput {
  const message = input.receiptId
    ? `${input.message}\n\nReceipt ${input.receiptId}\n${new URL(`/app/receipts/${input.receiptId}`, ctx.appUrl)}`
    : input.message;
  const mail = supportMessageEmail(ctx, {
    senderName: input.name,
    from: input.from,
    topicLabel: KIND_LABELS[input.kind],
    message,
  });
  return { to: input.to, replyTo: input.from, ...mail };
}
