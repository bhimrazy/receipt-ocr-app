"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import { Field, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, Send, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Turnstile, useTurnstile } from "@/components/turnstile";
import { hasSignedInHint } from "@/lib/signed-in-hint";
import type { SupportTopic } from "@/lib/support-widget";

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

/** The route's limit too. */
const MAX_NAME = 80;

/**
 * The support form, loaded on first open. It stays mounted after that (rendering nothing while
 * closed) so a half-written message survives closing; Turnstile mounts only while it is open.
 */
export default function SupportPanel({
  open,
  topic,
  onTopicChange,
  onClose,
}: {
  open: boolean;
  topic: SupportTopic;
  onTopicChange: (topic: SupportTopic) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const turnstile = useTurnstile();

  // Signed in: start from the account's name and address, still editable. The hint cookie spares
  // visitors a session request.
  useEffect(() => {
    if (!hasSignedInHint()) return;
    let live = true;
    fetch("/api/auth/get-session", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { user?: { name?: unknown; email?: unknown } } | null) => {
        const user = body?.user;
        if (!live || !user) return;
        const { name: accountName, email: accountEmail } = user;
        if (typeof accountName === "string") setName((v) => v || accountName.slice(0, MAX_NAME));
        if (typeof accountEmail === "string") setEmail((v) => v || accountEmail);
        // Both filled: skip to the message, unless the visitor has moved on from the name field.
        if (
          typeof accountName === "string" &&
          accountName.trim() &&
          typeof accountEmail === "string" &&
          accountEmail &&
          document.activeElement === nameRef.current
        ) {
          messageRef.current?.focus();
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    setError(null);
    if (turnstile.blocker) {
      if (!turnstile.broken) {
        setStatus("error");
        setError(turnstile.blocker);
      }
      return;
    }
    setStatus("sending");
    const company =
      (event.currentTarget.elements.namedItem("company") as HTMLInputElement | null)?.value ?? "";
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...turnstile.fetchOptions?.headers },
        body: JSON.stringify({ name, email, message, topic, company }),
      });
      turnstile.reset();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Your message didn't send. Try again in a moment.");
      }
      setStatus("sent");
      setMessage("");
    } catch (err) {
      turnstile.reset();
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Your message didn't send. Try again in a moment.",
      );
    }
  };

  const firstName = name.trim().split(/\s+/)[0] ?? "";

  const sendAnother = () => {
    setStatus("idle");
    // The form remounts on the next render.
    requestAnimationFrame(() => messageRef.current?.focus());
  };

  const activeTopic = TOPICS.find((t) => t.id === topic) ?? TOPICS[0];

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-labelledby={`${ids}-title`}
      className="flex max-h-[calc(100dvh-5.5rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-card/95 shadow-2xl shadow-black/50 light:shadow-float ring-1 ring-hairline backdrop-blur-xl motion-safe:animate-fade-up"
    >
      <div className="relative shrink-0 border-b border-border bg-secondary/30 p-4 pr-14">
        <p className="text-sm font-semibold" id={`${ids}-title`}>
          How can we help?
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-1.5 top-1.5 flex size-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-wash hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
        {status === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Check aria-hidden className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {firstName ? `Thanks, ${firstName}!` : "Message sent"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your message is on its way. We&apos;ll reply to {email.trim()}.
              </p>
            </div>
            <Button onClick={sendAnother} size="sm" variant="ghost">
              Send another
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Topic</legend>
              <div className="flex flex-wrap gap-1.5">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={topic === t.id}
                    onClick={() => onTopicChange(t.id)}
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
              <FieldLabel className="text-xs text-muted-foreground" htmlFor={`${ids}-name`}>
                Name
              </FieldLabel>
              <Input
                ref={nameRef}
                id={`${ids}-name`}
                required
                maxLength={MAX_NAME}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className={cn("h-11", fieldClass)}
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs text-muted-foreground" htmlFor={`${ids}-email`}>
                Email
              </FieldLabel>
              <Input
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
                ref={messageRef}
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

            <Button
              aria-busy={turnstile.pending}
              type="submit"
              disabled={status === "sending"}
              className="h-11 w-full"
            >
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
  );
}
