import { describe, expect, it } from "vitest";
import { isRoutineAuthRead } from "@/lib/auth-routine";

const get = (path: string, method = "GET") => new Request(`https://app.example${path}`, { method });

describe("isRoutineAuthRead", () => {
  it("samples only read-only session and list endpoints", () => {
    expect(isRoutineAuthRead(get("/api/auth/get-session"))).toBe(true);
    expect(isRoutineAuthRead(get("/api/auth/organization/list"))).toBe(true);
  });

  it("never treats a callback, verification or reset as routine, whatever the query", () => {
    for (const path of [
      "/api/auth/callback/google?code=x&state=y",
      "/api/auth/callback/github",
      "/api/auth/verify-email?token=t&callbackURL=/app",
      "/api/auth/reset-password/tok123?callbackURL=/reset-password",
      "/api/auth/oauth2/callback/x",
      "/api/auth/get-session/extra",
      "/api/auth/organization/accept-invitation",
    ]) {
      expect(isRoutineAuthRead(get(path)), path).toBe(false);
    }
  });

  it("never treats a POST as routine", () => {
    expect(isRoutineAuthRead(get("/api/auth/get-session", "POST"))).toBe(false);
  });
});
