import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_MODE_SCRIPT,
  signedOutPath,
  standaloneFromCookies,
  standaloneHome,
} from "./display-mode";
import { launchedFromPwa } from "./signed-in-hint";
import { checkEvent } from "./telemetry/analytics";

describe("standaloneFromCookies", () => {
  it("is true only with the app's display_mode cookie", () => {
    expect(standaloneFromCookies("a=1; display_mode=standalone; b=2")).toBe(true);
    expect(standaloneFromCookies("display_mode=browser")).toBe(false);
    expect(standaloneFromCookies("x_display_mode=standalone")).toBe(false);
    expect(standaloneFromCookies(undefined)).toBe(false);
  });

  it("rides on signed_up as a boolean prop", () => {
    expect(
      checkEvent({ name: "signed_up", userId: "u_1", props: { method: "email", standalone: true } })
        ?.props,
    ).toEqual({ method: "email", standalone: true });
  });
});

describe("launchedFromPwa", () => {
  it("matches the manifest's start URL only", () => {
    expect(launchedFromPwa("/app?source=pwa")).toBe(true);
    expect(launchedFromPwa("/app?source=pwa&shared=1")).toBe(true);
    expect(launchedFromPwa("/app")).toBe(false);
    expect(launchedFromPwa("/app/receipts?source=pwa")).toBe(false);
    expect(launchedFromPwa(null)).toBe(false);
  });
});

/** Runs the head script against a fake window; returns where it sent the page and what it marked. */
function runScript({
  standalone = false,
  iosStandalone = false,
  pathname = "/",
  cookie = "",
}: {
  standalone?: boolean;
  iosStandalone?: boolean;
  pathname?: string;
  cookie?: string;
}) {
  const attrs: Record<string, string> = {};
  const replaced: string[] = [];
  const matchMedia = (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
  });
  const navigator = iosStandalone ? { standalone: true } : {};
  const document = {
    cookie,
    documentElement: { setAttribute: (name: string, value: string) => (attrs[name] = value) },
  };
  const location = { pathname, replace: (to: string) => replaced.push(to) };
  new Function("matchMedia", "navigator", "document", "location", DISPLAY_MODE_SCRIPT)(
    matchMedia,
    navigator,
    document,
    location,
  );
  return { attrs, replaced };
}

describe("DISPLAY_MODE_SCRIPT", () => {
  it("leaves a browser tab alone, on / too", () => {
    expect(runScript({ cookie: "signed_in_hint=1" })).toEqual({ attrs: {}, replaced: [] });
  });

  it("sends the installed app from / to the app with a sign-in hint, else to sign-in", () => {
    expect(runScript({ standalone: true, cookie: "a=1; signed_in_hint=1" }).replaced).toEqual([
      "/app",
    ]);
    expect(runScript({ standalone: true, cookie: "signed_in_hint=0" }).replaced).toEqual([
      "/sign-in",
    ]);
    expect(runScript({ iosStandalone: true }).replaced).toEqual(["/sign-in"]);
  });

  it("marks <html> on every page but redirects only /", () => {
    expect(runScript({ standalone: true, pathname: "/terms" })).toEqual({
      attrs: { "data-display-mode": "standalone" },
      replaced: [],
    });
    expect(runScript({ standalone: true, pathname: "/pricing" }).replaced).toEqual([]);
  });
});

describe("standaloneHome", () => {
  it("is the app with a sign-in hint and sign-in without", () => {
    expect(standaloneHome(true)).toBe("/app");
    expect(standaloneHome(false)).toBe("/sign-in");
  });
});

describe("signedOutPath", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is sign-in in the installed app and the landing page in a tab", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(signedOutPath()).toBe("/sign-in");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(signedOutPath()).toBe("/");
  });
});
