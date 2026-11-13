import { describe, expect, it } from "vitest";
import { base32Decode, hotp, matchTotpStep, totpFromBase32, totpStep } from "@/lib/totp";
import { backupCodesText, formatTotpKey, totpKeyFromUri } from "@/lib/totp-uri";

const RFC_KEY = Buffer.from("12345678901234567890");

describe("TOTP helper", () => {
  it("matches the RFC 6238 SHA-1 vectors (last 6 digits)", () => {
    // RFC 6238 appendix B: T = 59 s → 94287082, T = 1111111109 → 07081804.
    expect(hotp(RFC_KEY, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(RFC_KEY, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("returns the matching step within ±1 and null outside it", () => {
    const now = 1_794_000_000_000;
    const secret = "12345678901234567890";
    const step = totpStep(now);
    expect(matchTotpStep(secret, hotp(RFC_KEY, step), now)).toBe(step);
    expect(matchTotpStep(secret, hotp(RFC_KEY, step - 1), now)).toBe(step - 1);
    expect(matchTotpStep(secret, hotp(RFC_KEY, step + 2), now)).toBeNull();
    expect(matchTotpStep(secret, "12345", now)).toBeNull();
  });

  it("reads the key from an otpauth URI and generates the same code", () => {
    const secret = "abcdefghijklmnopqrstuvwxyz012345";
    const uri = `otpauth://totp/ReceiptOCR:a%40b.c?secret=MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPIYDCMRTGQ2Q&issuer=ReceiptOCR`;
    const base32 = totpKeyFromUri(uri)!;
    expect(Buffer.from(base32Decode(base32)).toString()).toBe(secret);
    expect(matchTotpStep(secret, totpFromBase32(base32))).toBe(totpStep());
    expect(totpKeyFromUri("https://example.com/?secret=x")).toBeNull();
    expect(formatTotpKey("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });

  it("writes backup codes one per line under a header", () => {
    const text = backupCodesText(["aaaaa-bbbbb", "ccccc-ddddd"], "a@b.c", new Date("2026-11-07"));
    expect(text).toContain("Account: a@b.c\nCreated: 2026-11-07");
    expect(text.trim().split("\n").slice(-2)).toEqual(["aaaaa-bbbbb", "ccccc-ddddd"]);
  });
});
