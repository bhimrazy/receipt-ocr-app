import { describe, expect, it } from "vitest";
import { standaloneFromCookies } from "./display-mode";
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
    expect(launchedFromPwa("/app/history?source=pwa")).toBe(false);
    expect(launchedFromPwa(null)).toBe(false);
  });
});
