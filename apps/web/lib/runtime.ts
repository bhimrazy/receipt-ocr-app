import "server-only";
import { makeAppLayer } from "@receipt-ocr/core";
import { ManagedRuntime } from "effect";
import { WelcomeMailerLive } from "./welcome-mailer";

/**
 * Built once per server process: layers (DB pool, services) are constructed
 * on first use and shared by every request, instead of per call.
 */
export const runtime = ManagedRuntime.make(makeAppLayer(WelcomeMailerLive));
