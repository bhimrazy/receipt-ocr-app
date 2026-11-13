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
 * Support-inbox notice with a link to the admin list; replies go to the sender. The subject uses a
 * fixed label, never user text, and the message text stays in the database.
 */
export function contactEmail(
  ctx: EmailContext,
  input: { to: string; name: string; from: string; kind: SupportKind; messageId: string },
): SendEmailInput {
  const mail = supportMessageEmail(ctx, {
    senderName: input.name,
    topicLabel: KIND_LABELS[input.kind],
    messageRef: input.messageId.slice(0, 8),
    url: new URL("/admin/support", ctx.appUrl).toString(),
  });
  return { to: input.to, replyTo: input.from, ...mail };
}
