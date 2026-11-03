import "server-only";
import { AppLayer } from "@receipt-ocr/core";
import { ManagedRuntime } from "effect";

/**
 * Built once per server process: layers (DB pool, services) are constructed
 * on first use and shared by every request, instead of per call.
 */
export const runtime = ManagedRuntime.make(AppLayer);
