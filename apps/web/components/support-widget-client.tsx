"use client";

import { MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useHoldBottom } from "@/lib/bottom-slot";
import {
  SUPPORT_OPEN_EVENT,
  type SupportOpenDetail,
  type SupportTopic,
} from "@/lib/support-widget";

const loadPanel = () => import("@/components/support-panel");
// The form, its fields and Turnstile load on first open, not with the page.
type PanelComponent = ComponentType<
  React.ComponentProps<typeof import("@/components/support-panel").default>
>;

/**
 * Opens only when the visitor asks (the launcher or `openSupportWidget`); it never opens itself.
 * Without `launcher`, only `openSupportWidget` opens it, from the page's own Help rows.
 */
export function SupportWidgetClient({
  email,
  launcher = true,
}: {
  email?: string;
  launcher?: boolean;
}) {
  const [Panel, setPanel] = useState<PanelComponent | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>("getting-started");
  const [receiptId, setReceiptId] = useState<string | undefined>();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // An open panel keeps the install sheet away.
  useHoldBottom("support", open);

  const openWidget = useCallback((detail: SupportOpenDetail = {}) => {
    if (detail.topic) setTopic(detail.topic);
    setReceiptId(detail.receiptId);
    returnFocusRef.current =
      detail.returnFocus ?? (document.activeElement as HTMLElement | null) ?? launcherRef.current;
    setOpened(true);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    (returnFocusRef.current ?? launcherRef.current)?.focus();
  }, []);

  // Loaded on first open (a failed fetch, offline or a stale deploy, shows a retry, not an error page).
  useEffect(() => {
    if (!opened) return;
    let live = true;
    loadPanel().then(
      (mod) => live && setPanel(() => mod.default),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [opened, attempt]);

  useEffect(() => {
    const onOpen = (event: Event) => openWidget((event as CustomEvent<SupportOpenDetail>).detail);
    window.addEventListener(SUPPORT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(SUPPORT_OPEN_EVENT, onOpen);
  }, [openWidget]);

  return (
    <div className="fixed right-[max(0.5rem,env(safe-area-inset-right))] bottom-[calc(var(--site-bottom-inset,0px)+max(0.5rem,env(safe-area-inset-bottom)))] z-40 flex flex-col items-end gap-3 sm:right-5 sm:bottom-[calc(var(--site-bottom-inset,0px)+1.25rem)]">
      {opened ? (
        failed ? (
          <div
            role="alert"
            className="w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
            hidden={!open}
          >
            <p>Couldn&apos;t load the form{email ? <> — email us at {email}</> : null}.</p>
            <button
              type="button"
              className="mt-2 font-medium underline underline-offset-2"
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : Panel ? (
          <Panel
            onClose={close}
            onTopicChange={setTopic}
            open={open}
            receiptId={receiptId}
            topic={topic}
          />
        ) : null
      ) : null}

      {launcher ? (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => (open ? close() : openWidget())}
          onFocus={() => void loadPanel().catch(() => {})}
          onPointerEnter={() => void loadPanel().catch(() => {})}
          aria-label={open ? "Close support" : "Contact support"}
          aria-expanded={open}
          // The cta tokens keep white text legible over any page background.
          className="flex size-11 items-center justify-center rounded-full bg-cta text-cta-foreground shadow-lg shadow-black/40 light:shadow-float ring-2 ring-cta-foreground/80 transition hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring sm:size-12 motion-safe:hover:-translate-y-0.5"
        >
          {open ? (
            <X aria-hidden className="size-5" />
          ) : (
            <MessageCircle aria-hidden className="size-5" />
          )}
        </button>
      ) : null}
    </div>
  );
}
