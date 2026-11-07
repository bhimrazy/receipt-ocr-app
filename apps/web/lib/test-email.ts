import { sendEmail, testEmail, type EmailLogEvent } from "@receipt-ocr/email";
import { emailContext, emailEnv } from "./env";
import { logger } from "./log";

export type TestEmailOutcome = "sent" | "not-configured" | "failed";

/** Sends the admin's own test message through the app's mailer; never throws. */
export async function sendTestEmail(to: string): Promise<TestEmailOutcome> {
  const result = await sendEmail(
    {
      apiKey: emailEnv.resendApiKey,
      from: emailEnv.from,
      replyTo: emailEnv.replyTo,
      log: (event: EmailLogEvent) => logger.emit(event),
    },
    { to, ...(await testEmail(emailContext)) },
  );
  if (result.delivered) return "sent";
  return result.reason === "not_configured" ? "not-configured" : "failed";
}
