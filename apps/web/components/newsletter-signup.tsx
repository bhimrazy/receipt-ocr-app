"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Turnstile, useTurnstile } from "@/components/turnstile";

type Status = "idle" | "sending" | "sent" | "error";

const FAILED = "That didn't go through. Try again in a moment.";

/** Product-updates signup (double opt-in): the same answer for every address. */
export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const turnstile = useTurnstile();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    if (turnstile.blocker) {
      setStatus("error");
      setError(turnstile.blocker);
      return;
    }
    setStatus("sending");
    setError(null);
    const company =
      (event.currentTarget.elements.namedItem("company") as HTMLInputElement | null)?.value ?? "";
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...turnstile.fetchOptions?.headers },
        body: JSON.stringify({ email, company }),
      });
      turnstile.reset();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? FAILED);
      }
      setStatus("sent");
    } catch (err) {
      turnstile.reset();
      setStatus("error");
      setError(err instanceof Error ? err.message : FAILED);
    }
  };

  if (status === "sent") {
    return (
      <div
        className="flex items-start gap-3 rounded-xl bg-primary/8 p-4 text-sm leading-6 ring-1 ring-inset ring-primary/25"
        role="status"
      >
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <p>
          Check your inbox. If this address isn&apos;t on the list yet, we&apos;ve sent a link to
          confirm it. Nothing is added until you click it.
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit}>
      <label className="sr-only" htmlFor={`${ids}-email`}>
        Email address
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          aria-describedby={error ? `${ids}-error` : undefined}
          aria-invalid={status === "error" && error ? true : undefined}
          autoComplete="email"
          className="sm:flex-1"
          id={`${ids}-email`}
          inputMode="email"
          name="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        {/* Honeypot: off-screen and out of the tab order. */}
        <input
          aria-hidden
          autoComplete="off"
          className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
          name="company"
          tabIndex={-1}
          type="text"
        />
        <Button
          aria-busy={status === "sending" || turnstile.pending}
          className="max-md:h-11"
          disabled={status === "sending"}
          type="submit"
        >
          {status === "sending" ? "Sending…" : "Get product updates"}
        </Button>
      </div>
      <Turnstile className="mt-3" controller={turnstile} />
      {error ? (
        <p className="mt-3 text-sm leading-6 text-destructive" id={`${ids}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
