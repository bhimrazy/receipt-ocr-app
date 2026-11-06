"use client";

import { MessageCircle, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  SUPPORT_OPEN_EVENT,
  type SupportOpenDetail,
  type SupportTopic,
} from "@/lib/support-widget";

const loadPanel = () => import("@/components/support-panel");
// The form, its fields and Turnstile load on first open, not with the page. React.lazy rather
// than next/dynamic: the panel never renders on the server, and lazy adds no loader runtime.
const SupportPanel = lazy(loadPanel);

/** Opens only when the visitor asks (launcher or a ContactButton); it never opens itself. */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>("getting-started");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const openWidget = useCallback((nextTopic?: SupportTopic) => {
    if (nextTopic) setTopic(nextTopic);
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? launcherRef.current;
    setOpened(true);
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

  return (
    <div className="fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-[max(0.5rem,env(safe-area-inset-right))] z-40 flex flex-col items-end gap-3 sm:bottom-5 sm:right-5">
      {opened ? (
        <Suspense fallback={null}>
          <SupportPanel onClose={close} onTopicChange={setTopic} open={open} topic={topic} />
        </Suspense>
      ) : null}

      <button
        ref={launcherRef}
        type="button"
        onClick={() => (open ? close() : openWidget())}
        onFocus={() => void loadPanel()}
        onPointerEnter={() => void loadPanel()}
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
