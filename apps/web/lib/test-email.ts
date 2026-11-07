import { sendEmail, type EmailLogEvent, type SendEmailInput } from "@receipt-ocr/email";
import { emailEnv } from "./env";
import { logger } from "./log";

export type TestEmailOutcome = "sent" | "not-configured" | "failed";

export function testEmail(to: string): SendEmailInput {
  const text = "This is a test email from receiptOCR. Email delivery is working.";
  return {
    to,
    subject: "[receiptOCR] Test email",
    text,
    html: `<p>${text}</p>`,
  };
}

/** Sends the admin's own test message through the app's mailer; never throws. */
export async function sendTestEmail(to: string): Promise<TestEmailOutcome> {
  const result = await sendEmail(
    {
      apiKey: emailEnv.resendApiKey,
      from: emailEnv.from,
      log: (event: EmailLogEvent) => logger.emit(event),
    },
    testEmail(to),
  );
  if (result.delivered) return "sent";
  return result.reason === "not_configured" ? "not-configured" : "failed";
}
