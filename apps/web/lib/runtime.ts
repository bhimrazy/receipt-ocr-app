import "server-only";
import { makeAppLayer } from "@receipt-ocr/core";
import { Layer, ManagedRuntime } from "effect";
import { ContactReplyMailerLive } from "./contact-reply-mailer";
import { SupportNotifyMailerLive } from "./support-notify-mailer";
import { WelcomeMailerLive } from "./welcome-mailer";

/**
 * Built once per server process: layers (DB pool, services) are constructed
 * on first use and shared by every request, instead of per call.
 */
export const runtime = ManagedRuntime.make(
  makeAppLayer(Layer.mergeAll(WelcomeMailerLive, ContactReplyMailerLive, SupportNotifyMailerLive)),
);
