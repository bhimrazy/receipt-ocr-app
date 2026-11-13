import { describe, expect, it } from "vitest";
import { applyInput, applyPaste, boxAt, overwriteDigit, sanitizeOtp } from "../../src/lib/otp";

describe("sanitizeOtp", () => {
  it("strips spaces, dashes and letters and caps at six", () => {
    expect(sanitizeOtp("123 456")).toBe("123456");
    expect(sanitizeOtp("123-456")).toBe("123456");
    expect(sanitizeOtp("a1b2c3d4e5f6g7")).toBe("123456");
    expect(sanitizeOtp("")).toBe("");
  });
});

describe("applyInput", () => {
  it("completes once, on the sixth digit", () => {
    expect(applyInput("1234", "12345")).toEqual({ value: "12345", complete: false });
    expect(applyInput("12345", "123456")).toEqual({ value: "123456", complete: true });
    expect(applyInput("123456", "12345")).toEqual({ value: "12345", complete: false });
  });
  it("does not complete again while the code stays full", () => {
    expect(applyInput("123456", "123456").complete).toBe(false);
  });
  it("goes back on backspace", () => {
    expect(applyInput("123", "12")).toEqual({ value: "12", complete: false });
  });
});

describe("applyPaste", () => {
  it("accepts a code with a space or dash and completes", () => {
    expect(applyPaste("", 0, 0, "123 456")).toMatchObject({ value: "123456", complete: true });
    expect(applyPaste("", 0, 0, "123-456")).toMatchObject({ value: "123456", complete: true });
  });
  it("replaces a partial entry with a whole pasted code", () => {
    expect(applyPaste("12", 2, 2, "654321")).toMatchObject({ value: "654321", complete: true });
  });
  it("splices shorter text over the selection", () => {
    expect(applyPaste("123456", 0, 6, "78")).toMatchObject({ value: "78", complete: false });
    expect(applyPaste("12", 2, 2, "34")).toMatchObject({ value: "1234", caret: 4 });
  });
  it("ignores text with no digits", () => {
    expect(applyPaste("12", 2, 2, "abc")).toEqual({ value: "12", caret: 2, complete: false });
  });
});

describe("overwriteDigit", () => {
  it("replaces the digit under the caret in a full code", () => {
    expect(overwriteDigit("123456", 2, "9")).toEqual({ value: "129456", caret: 3 });
  });
  it("leaves partial codes and non-digits to the field", () => {
    expect(overwriteDigit("12345", 2, "9")).toBeNull();
    expect(overwriteDigit("123456", 2, "x")).toBeNull();
    expect(overwriteDigit("123456", 6, "9")).toBeNull();
  });
});

describe("boxAt", () => {
  it("maps a tap to a box and stops at the first empty one", () => {
    expect(boxAt(5, 300, 6)).toBe(0);
    expect(boxAt(295, 300, 6)).toBe(5);
    expect(boxAt(295, 300, 2)).toBe(2);
  });
});
