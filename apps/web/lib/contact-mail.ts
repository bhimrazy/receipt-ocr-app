import { supportMessageEmail, type EmailContext, type SendEmailInput } from "@receipt-ocr/email";

const TOPIC_LABELS = {
  "getting-started": "Question",
  "use-case": "Plans & limits",
  feature: "Feature request",
  problem: "Problem report",
} as const;

/** How the auto-reply names the topic: "We've received {phrase}". */
const TOPIC_PHRASES: Record<keyof typeof TOPIC_LABELS, string> = {
  "getting-started": "your question",
  "use-case": "your question about plans and limits",
  feature: "your feature request",
  problem: "your problem report",
};

export function isTopic(value: string): value is keyof typeof TOPIC_LABELS {
  return value in TOPIC_LABELS;
}

export const topicPhrase = (topic: string) =>
  isTopic(topic) ? TOPIC_PHRASES[topic] : TOPIC_PHRASES["getting-started"];

/** Support-inbox message; replies go to the visitor. The subject uses a fixed label, never user text. */
export function contactEmail(
  ctx: EmailContext,
  input: {
    to: string;
    name: string;
    from: string;
    topic: keyof typeof TOPIC_LABELS;
    message: string;
  },
): SendEmailInput {
  const mail = supportMessageEmail(ctx, {
    senderName: input.name,
    from: input.from,
    topicLabel: TOPIC_LABELS[input.topic],
    message: input.message,
  });
  return { to: input.to, replyTo: input.from, ...mail };
}
