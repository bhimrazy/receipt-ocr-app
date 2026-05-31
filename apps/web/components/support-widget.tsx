"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { Check, MessageCircle, Send, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  SUPPORT_OPEN_EVENT,
  type SupportOpenDetail,
  type SupportTopic,
} from "@/lib/support-widget";

const TOPICS: Array<{ id: SupportTopic; label: string; prompt: string }> = [
  { id: "getting-started", label: "Getting started", prompt: "Ask us anything…" },
  {
    id: "use-case",
    label: "What I'm looking for",
    prompt: "What are you trying to do with your receipts?",
  },
  { id: "feature", label: "Request a feature", prompt: "What would you like us to build?" },
];

const SEEN_KEY = "support:seen";
const AUTO_OPEN_DELAY = 60_000; // first-time visitors get a nudge after a minute

type Status = "idle" | "sending" | "sent" | "error";

export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>("getting-started");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // private mode / storage disabled — nothing to persist, no-op
    }
  }, []);

  const openWidget = useCallback(
    (nextTopic?: SupportTopic) => {
      if (nextTopic) setTopic(nextTopic);
      setOpen(true);
      markSeen();
    },
    [markSeen],
  );

  // Let other components (pricing "Contact us") open the widget on demand.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<SupportOpenDetail>).detail;
      openWidget(detail?.topic);
    };
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, [openWidget]);

  // Nudge first-time visitors once, ever — repeat visitors are left alone.
  useEffect(() => {
    let seen = "1";
    try {
      seen = window.localStorage.getItem(SEEN_KEY) ?? "";
    } catch {
      seen = "1"; // can't tell if they've seen it — don't risk nagging
    }
    if (seen) return;
    const timer = window.setTimeout(() => openWidget(), AUTO_OPEN_DELAY);
    return () => window.clearTimeout(timer);
  }, [openWidget]);

  // Focus the first field and wire Escape-to-close while open.
  useEffect(() => {
    if (!open) return;
    emailRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setError(null);

    const company =
      (event.currentTarget.elements.namedItem("company") as HTMLInputElement | null)?.value ?? "";

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message, topic, company }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }
      setStatus("sent");
      setEmail("");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const activeTopic = TOPICS.find((t) => t.id === topic) ?? TOPICS[0];

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          role="dialog"
          aria-label="Support"
          className="w-[min(360px,calc(100vw-2.5rem))] animate-fade-up overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <div className="relative border-b border-border bg-secondary/30 p-4 pr-11">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                <MessageCircle className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">How can we help?</p>
                <p className="text-xs text-muted-foreground">
                  We read every message and reply by email.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close support"
              className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="p-4">
            {status === "sent" ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Message sent</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Thanks for reaching out — we&apos;ll reply by email soon.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTopic(t.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${
                        topic === t.id
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <Input
                  ref={emailRef}
                  type="email"
                  required
                  placeholder="you@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                />

                <textarea
                  required
                  rows={3}
                  placeholder={activeTopic.prompt}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full resize-none rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
                />

                {/* honeypot: visually hidden, off the tab order, ignored by humans */}
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden
                  className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
                />

                {error && <p className="text-xs text-red-300">{error}</p>}

                <Button type="submit" disabled={status === "sending"} className="w-full">
                  {status === "sending" ? (
                    "Sending…"
                  ) : (
                    <>
                      Send message <Send className="size-3.5" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openWidget())}
        aria-label={open ? "Close support" : "Open support"}
        aria-expanded={open}
        className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_30px_color-mix(in_oklab,var(--primary)_30%,transparent)] transition hover:-translate-y-0.5 hover:shadow-[0_0_42px_color-mix(in_oklab,var(--primary)_42%,transparent)]"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </button>
    </div>
  );
}
