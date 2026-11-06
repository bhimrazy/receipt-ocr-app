"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Header both Better Auth's captcha plugin and /api/contact read the token from. */
export const CAPTCHA_HEADER = "x-captcha-response";

const WAIT_MESSAGE = "Wait for the security check to finish, then try again.";
const BROKEN_MESSAGE =
  "The security check didn't load. Turn off content blockers for this site, or reload the page.";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileController {
  /** False when no site key is set: forms then skip the check entirely. */
  enabled: boolean;
  /** Why the form must not submit yet, or null when it may go ahead. */
  blocker: string | null;
  /** True when the script or widget failed: <Turnstile> already shows that error. */
  broken: boolean;
  /** True while the first token is pending, for aria-busy on the submit button. */
  pending: boolean;
  /** Spread into an `authClient` call's `fetchOptions`; `undefined` when there is no token. */
  fetchOptions: { headers: Record<string, string> } | undefined;
  /** Tokens are single use: call after every submit, successful or not, to get a fresh one. */
  reset: () => void;
  /** @internal for <Turnstile>. */
  widget: {
    setToken: (token: string | null) => void;
    setBroken: (broken: boolean) => void;
    attach: (widgetId: string | null) => void;
    broken: boolean;
  };
}

export function useTurnstile(): TurnstileController {
  const [token, setToken] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const widgetId = useRef<string | null>(null);

  const attach = useCallback((id: string | null) => {
    widgetId.current = id;
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);

  return useMemo(
    () => ({
      enabled: Boolean(SITE_KEY),
      blocker: !SITE_KEY || token ? null : broken ? BROKEN_MESSAGE : WAIT_MESSAGE,
      fetchOptions: token ? { headers: { [CAPTCHA_HEADER]: token } } : undefined,
      broken,
      pending: Boolean(SITE_KEY) && !token && !broken,
      reset,
      widget: { setToken, setBroken, attach, broken },
    }),
    [token, broken, reset, attach],
  );
}

/**
 * Cloudflare Turnstile in managed, interaction-only mode: invisible unless Cloudflare needs the
 * visitor to do something. Loads Cloudflare's script only while mounted, so mount it just where a
 * form needs it. Renders nothing when no site key is set.
 */
export function Turnstile({ controller }: { controller: TurnstileController }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { setToken, setBroken, attach, broken } = controller.widget;

  useEffect(() => {
    const node = container.current;
    if (!SITE_KEY || !ready || !node || !window.turnstile) return;
    const turnstile = window.turnstile;
    const id = turnstile.render(node, {
      sitekey: SITE_KEY,
      theme: "dark",
      size: "flexible",
      appearance: "interaction-only",
      callback: (token: string) => {
        setBroken(false);
        setToken(token);
      },
      "expired-callback": () => setToken(null),
      "timeout-callback": () => setToken(null),
      "error-callback": () => {
        setToken(null);
        setBroken(true);
      },
    });
    attach(id);
    return () => {
      turnstile.remove(id);
      attach(null);
      setToken(null);
    };
  }, [ready, setToken, setBroken, attach]);

  if (!SITE_KEY) return null;
  return (
    <>
      <Script onError={() => setBroken(true)} onReady={() => setReady(true)} src={SCRIPT_SRC} />
      <div
        className="w-full empty:hidden"
        data-turnstile={controller.blocker ? "pending" : "ready"}
        ref={container}
      />
      {broken ? (
        <p className="text-sm leading-6 text-destructive" role="alert">
          {BROKEN_MESSAGE}
        </p>
      ) : null}
    </>
  );
}
