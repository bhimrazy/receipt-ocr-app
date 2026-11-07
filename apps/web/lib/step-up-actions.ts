"use server";

import { STEP_UP_ACTIONS } from "@receipt-ocr/core";
import { headers } from "next/headers";
import { z } from "zod";
import { clientIp } from "./http";
import { getSession } from "./session";
import {
  sendStepUpCode,
  stepUpOptions,
  verifyStepUp,
  type StepUpOptions,
  type StepUpResult,
} from "./step-up";

/** Server actions behind the "Verify it's you" dialog. Next checks each action's Origin. */

const actionSchema = z.union([
  z.enum(STEP_UP_ACTIONS),
  z.custom<`admin.${string}`>(
    (value) => typeof value === "string" && /^admin\.[a-z_.-]{1,60}$/.test(value),
  ),
]);

const SIGNED_OUT = { ok: false as const, error: "Your session ended. Sign in again." };

async function caller() {
  const session = await getSession();
  if (!session) return null;
  const requestHeaders = await headers();
  return {
    session: session.session,
    user: session.user,
    ip: clientIp({ headers: requestHeaders }),
    headers: requestHeaders,
  };
}

export async function stepUpOptionsAction(input: { action: string }): Promise<StepUpOptions> {
  const parsed = z.object({ action: actionSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Reload and try again." };
  const who = await caller();
  return who ? stepUpOptions(who, parsed.data.action) : SIGNED_OUT;
}

export async function sendStepUpCodeAction(input: { action: string }): Promise<StepUpResult> {
  const parsed = z.object({ action: actionSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Reload and try again." };
  const who = await caller();
  return who ? sendStepUpCode(who, parsed.data.action) : SIGNED_OUT;
}

export async function verifyStepUpAction(input: {
  action: string;
  method: "totp" | "backup_code" | "email";
  code: string;
}): Promise<StepUpResult> {
  const parsed = z
    .object({
      action: actionSchema,
      method: z.enum(["totp", "backup_code", "email"]),
      code: z.string().trim().min(1, "Enter the code.").max(32),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter the code." };
  }
  const who = await caller();
  return who ? verifyStepUp(who, parsed.data) : SIGNED_OUT;
}
