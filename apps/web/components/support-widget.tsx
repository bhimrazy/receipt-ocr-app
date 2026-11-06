"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Field, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, MessageCircle, Send, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { Turnstile, useTurnstile } from "@/components/turnstile";
import {
  SUPPORT_OPEN_EVENT,
  type SupportOpenDetail,
  type SupportTopic,
} from "@/lib/support-widget";

const TOPICS: Array<{ id: SupportTopic; label: string; prompt: string }> = [
  { id: "getting-started", label: "Question", prompt: "Ask us anything" },
  {
    id: "use-case",
    label: "Plans & limits",
    prompt: "How many receipts a month, and what do you need?",
  },
  { id: "feature", label: "Feature request", prompt: "What would you like us to build?" },
];

// Ring, not border: coloured border utilities lose to the theme's global border-color today.
const fieldClass =
  "ring-1 ring-inset ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring";

type Status = "idle" | "sending" | "sent" | "error";

/** Opens only when the visitor asks (launcher or a ContactButton); it never opens itself. */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>("getting-started");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const ids = useId();
  const turnstile = useTurnstile();

  const openWidget = useCallback((nextTopic?: SupportTopic) => {
    if (nextTopic) setTopic(nextTopic);
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? launcherRef.current;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    (returnFocusRef.current ?? launcherRef.current)?.focus();
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) =>
      openWidget((event as CustomEvent<SupportOpenDetail>).detail?.topic);
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, [openWidget]);

  useEffect(() => {
    if (!open) return;
    emailRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    setError(null);
    if (turnstile.blocker) {
      setStatus("error");
      setError(turnstile.blocker);
      return;
    }
    setStatus("sending");
    const company =
      (event.currentTarget.elements.namedItem("company") as HTMLInputElement | null)?.value ?? "";
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...turnstile.fetchOptions?.headers },
        body: JSON.stringify({ email, message, topic, company }),
      });
      turnstile.reset();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Your message didn't send. Try again in a moment.");
      }
      setStatus("sent");
      setEmail("");
      setMessage("");
    } catch (err) {
      turnstile.reset();
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Your message didn't send. Try again in a moment.",
      );
    }
  };

  const activeTopic = TOPICS.find((t) => t.id === topic) ?? TOPICS[0];

  return (
    <div className="fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-[max(0.5rem,env(safe-area-inset-right))] z-40 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
      {open && (
        <div
          role="dialog"
          aria-labelledby={`${ids}-title`}
          className="w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-card/95 shadow-2xl shadow-black/50 ring-1 ring-hairline backdrop-blur-xl motion-safe:animate-fade-up"
        >
          <div className="relative border-b border-border bg-secondary/30 p-4 pr-14">
            <p className="text-sm font-semibold" id={`${ids}-title`}>
              Talk to us
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">We reply by email.</p>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-wash hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          <div className="p-4">
            {status === "sent" ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check aria-hidden className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Message sent</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    We&apos;ll reply to your email.
                  </p>
                </div>
                <Button onClick={() => setStatus("idle")} size="sm" variant="ghost">
                  Send another
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Topic
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {TOPICS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={topic === t.id}
                        onClick={() => setTopic(t.id)}
                        className={cn(
                          "min-h-9 rounded-full px-3 text-xs ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          topic === t.id
                            ? "bg-primary/10 text-primary ring-primary/40"
                            : "text-muted-foreground ring-border hover:text-foreground",
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <Field>
                  <FieldLabel className="text-xs text-muted-foreground" htmlFor={`${ids}-email`}>
                    Your email
                  </FieldLabel>
                  <Input
                    ref={emailRef}
                    id={`${ids}-email`}
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    className={cn("h-11", fieldClass)}
                  />
                </Field>

                <Field>
                  <FieldLabel className="text-xs text-muted-foreground" htmlFor={`${ids}-message`}>
                    Message
                  </FieldLabel>
                  <textarea
                    id={`${ids}-message`}
                    required
                    rows={3}
                    placeholder={activeTopic.prompt}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    className={cn(
                      "w-full resize-none rounded-lg bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground",
                      fieldClass,
                    )}
                  />
                </Field>

                {/* Honeypot: off-screen and out of the tab order. */}
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
                />

                <Turnstile controller={turnstile} />

                {error ? (
                  <Alert className="text-xs" variant="destructive">
                    {error}
                  </Alert>
                ) : null}

                <Button type="submit" disabled={status === "sending"} className="h-11 w-full">
                  {status === "sending" ? (
                    "Sending…"
                  ) : (
                    <>
                      Send message <Send aria-hidden className="size-3.5" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => (open ? close() : openWidget())}
        aria-label={open ? "Close support" : "Contact support"}
        aria-expanded={open}
        // The cta tokens keep white text legible over any page background.
        className="flex size-11 items-center justify-center rounded-full bg-cta text-cta-foreground shadow-lg shadow-black/40 ring-2 ring-cta-foreground/80 transition hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring sm:size-12 motion-safe:hover:-translate-y-0.5"
      >
        {open ? (
          <X aria-hidden className="size-5" />
        ) : (
          <MessageCircle aria-hidden className="size-5" />
        )}
      </button>
    </div>
  );
}
