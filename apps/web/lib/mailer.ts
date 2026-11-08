import "server-only";
import { type EmailLogEvent } from "@receipt-ocr/email";
import { emailEnv, logUndeliveredMail } from "./env";
import { logger } from "./log";

/** The Resend settings every outgoing message uses. */
export const mailer = {
  apiKey: emailEnv.resendApiKey,
  from: emailEnv.from,
  replyTo: emailEnv.replyTo,
  logUndelivered: logUndeliveredMail(),
  log: (event: EmailLogEvent) => logger.emit(event),
};
