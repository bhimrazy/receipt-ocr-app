"use server";

import { confirmNewsletter, unsubscribeNewsletter } from "@receipt-ocr/core";
import { Effect } from "effect";
import { redirect } from "next/navigation";
import { NewsletterGatewayLive } from "@/lib/newsletter";
import { runtime } from "@/lib/runtime";

const run = (step: "confirm" | "unsubscribe", token: unknown) => {
  if (typeof token !== "string" || token.length > 1024) return Promise.resolve("invalid" as const);
  const effect = step === "confirm" ? confirmNewsletter(token) : unsubscribeNewsletter(token);
  return runtime.runPromise(effect.pipe(Effect.provide(NewsletterGatewayLive)));
};

/** Mail scanners open links without asking, so the page only acts when its button is pressed. */
export async function confirmAction(formData: FormData) {
  const result = await run("confirm", formData.get("t"));
  redirect(`/newsletter/confirm?r=${result}`);
}

export async function unsubscribeAction(formData: FormData) {
  const result = await run("unsubscribe", formData.get("t"));
  redirect(`/newsletter/unsubscribe?r=${result}`);
}
