import { describe, expect, it } from "vitest";
import { keyboardInset } from "./keyboard-inset";

describe("keyboardInset", () => {
  it("is 0 with no keyboard", () => {
    expect(keyboardInset(844, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
  });
  it("is the part of the layout viewport the keyboard covers", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0, scale: 1 })).toBe(336);
  });
  it("allows for iOS panning the visual viewport down", () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 120, scale: 1 })).toBe(216);
  });
  it("ignores sub-pixel rounding and pinch zoom", () => {
    expect(keyboardInset(844, { height: 843.6, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset(844, { height: 422, offsetTop: 100, scale: 2 })).toBe(0);
  });
  it("never goes negative", () => {
    expect(keyboardInset(800, { height: 844, offsetTop: 0, scale: 1 })).toBe(0);
  });
});
