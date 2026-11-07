import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMERA_MEDIA_QUERY, wantsCamera } from "./camera";

function stubWindow(matches: (q: string) => boolean) {
  vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: matches(q) }) });
}

describe("wantsCamera", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is true when the media query matches (touch or narrow)", () => {
    stubWindow((q) => q === CAMERA_MEDIA_QUERY);
    expect(wantsCamera()).toBe(true);
  });

  it("is false on a fine-pointer desktop", () => {
    stubWindow(() => false);
    expect(wantsCamera()).toBe(false);
  });

  it("is false without a window", () => {
    expect(wantsCamera()).toBe(false);
  });
});
