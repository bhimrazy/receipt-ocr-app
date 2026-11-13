import { betterAuth } from "better-auth";
import { captcha } from "better-auth/plugins/captcha";
import { describe, expect, it } from "vitest";
import { CAPTCHA_ENDPOINTS } from "@/lib/captcha-endpoints";

// No database (memory adapter) and no network: without an x-captcha-response header the plugin
// answers 400 MISSING_RESPONSE before it would contact Cloudflare.
const auth = betterAuth({
  baseURL: "http://localhost:3004",
  secret: "test-secret-not-for-production-0000000000",
  emailAndPassword: { enabled: true },
  socialProviders: { github: { clientId: "x", clientSecret: "y" } },
  advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
  logger: { disabled: true },
  plugins: [
    captcha({
      provider: "cloudflare-turnstile",
      secretKey: "dummy",
      endpoints: [...CAPTCHA_ENDPOINTS],
    }),
  ],
});

const bodies: Record<(typeof CAPTCHA_ENDPOINTS)[number], object> = {
  "/sign-up/email": { name: "a", email: "a@b.co", password: "password123" },
  "/sign-in/email": { email: "a@b.co", password: "password123" },
  "/request-password-reset": { email: "a@b.co", redirectTo: "/reset-password" },
  "/send-verification-email": { email: "a@b.co", callbackURL: "/app" },
};

function post(path: string, body: object) {
  return auth.handler(
    new Request(`http://localhost:3004/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3004",
        "x-forwarded-for": "203.0.113.9",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("captcha endpoints", () => {
  it.each(CAPTCHA_ENDPOINTS)("%s refuses a request with no token", async (path) => {
    const res = await post(path, bodies[path]);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "MISSING_RESPONSE" });
  });

  it("leaves OAuth sign-in and reset-password alone", async () => {
    const social = await post("/sign-in/social", { provider: "github", callbackURL: "/app" });
    expect(social.status).not.toBe(400);
    const reset = await post("/reset-password", { newPassword: "password123", token: "t" });
    expect(await reset.text()).not.toContain("MISSING_RESPONSE");
  });
});
