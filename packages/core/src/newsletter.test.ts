import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  confirmNewsletter,
  NewsletterGateway,
  requestNewsletterSubscription,
  signNewsletterToken,
  unsubscribeNewsletter,
  verifyNewsletterToken,
  type GatewayOutcome,
} from "./newsletter";
import { Db } from "./services";

const secret = "test-secret-with-enough-length-0123456789";
const now = Date.UTC(2026, 10, 8);

describe("newsletter tokens", () => {
  it("round-trips the normalized address", () => {
    const token = signNewsletterToken(secret, "confirm", " Ada@Example.COM ", {
      now,
      ttlSeconds: 60,
    });
    expect(verifyNewsletterToken(secret, "confirm", token, now)).toEqual({
      ok: true,
      email: "ada@example.com",
    });
  });

  it("expires after the lifetime but never when none is set", () => {
    const short = signNewsletterToken(secret, "confirm", "a@b.co", { now, ttlSeconds: 60 });
    expect(verifyNewsletterToken(secret, "confirm", short, now + 61_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    const forever = signNewsletterToken(secret, "unsubscribe", "a@b.co", { now });
    expect(
      verifyNewsletterToken(secret, "unsubscribe", forever, now + 10 * 365 * 86_400_000).ok,
    ).toBe(true);
  });

  it("rejects a token for the other purpose, another secret, tampering and junk", () => {
    const token = signNewsletterToken(secret, "unsubscribe", "a@b.co");
    expect(verifyNewsletterToken(secret, "confirm", token).ok).toBe(false);
    expect(
      verifyNewsletterToken("another-secret-another-secret-00000", "unsubscribe", token).ok,
    ).toBe(false);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "unsubscribe", e: "victim@b.co" })).toString(
      "base64url",
    );
    expect(verifyNewsletterToken(secret, "unsubscribe", `${forged}.${mac}`).ok).toBe(false);
    for (const junk of ["", "a", "a.b", `${body}.`, `${token}.x`, "x".repeat(2000)]) {
      expect(verifyNewsletterToken(secret, "unsubscribe", junk)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
});

function setup(options: { allowed?: boolean; gateway?: GatewayOutcome } = {}) {
  const calls: Record<string, unknown[]> = { mail: [], subscribe: [], unsubscribe: [] };
  const gateway = Layer.succeed(NewsletterGateway, {
    secret,
    appUrl: "https://app.example",
    sendConfirmation: (input) => {
      calls.mail!.push(input);
      return Effect.succeed(options.gateway ?? "ok");
    },
    subscribe: (email) => {
      calls.subscribe!.push(email);
      return Effect.succeed(options.gateway ?? "ok");
    },
    unsubscribe: (email) => {
      calls.unsubscribe!.push(email);
      return Effect.succeed(options.gateway ?? "ok");
    },
  });
  const chain = {
    insert: () => chain,
    values: () => chain,
    onConflictDoUpdate: () => chain,
    returning: async () => [{ count: options.allowed === false ? 99 : 1, lastRequest: Date.now() }],
  };
  const db = Layer.succeed(Db, {
    client: chain as never,
    use: (query) => Effect.promise(() => query(chain as never)),
  });
  const run = <A>(effect: Effect.Effect<A, unknown, NewsletterGateway | Db>) =>
    Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(gateway, db))));
  return { calls, run };
}

describe("newsletter service", () => {
  it("mails a confirm link and an unsubscribe link, and adds nobody yet", async () => {
    const { calls, run } = setup();
    expect(await run(requestNewsletterSubscription("Ada@Example.com"))).toBe("sent");
    expect(calls.subscribe).toHaveLength(0);
    const mail = calls.mail![0] as { to: string; confirmUrl: string; unsubscribeUrl: string };
    expect(mail.to).toBe("ada@example.com");
    const confirmToken = new URL(mail.confirmUrl).searchParams.get("t")!;
    const leaveToken = new URL(mail.unsubscribeUrl).searchParams.get("t")!;
    expect(verifyNewsletterToken(secret, "confirm", confirmToken).ok).toBe(true);
    expect(verifyNewsletterToken(secret, "unsubscribe", leaveToken).ok).toBe(true);
  });

  it("sends nothing once the address is over its hourly cap", async () => {
    const { calls, run } = setup({ allowed: false });
    expect(await run(requestNewsletterSubscription("a@b.co"))).toBe("rate_limited");
    expect(calls.mail).toHaveLength(0);
  });

  it("reports a gateway failure without throwing", async () => {
    const { run } = setup({ gateway: "failed" });
    expect(await run(requestNewsletterSubscription("a@b.co"))).toBe("failed");
  });

  it("adds the contact only for a valid confirm token", async () => {
    const { calls, run } = setup();
    const good = signNewsletterToken(secret, "confirm", "a@b.co", { ttlSeconds: 60 });
    expect(await run(confirmNewsletter(good))).toBe("done");
    expect(calls.subscribe).toEqual(["a@b.co"]);
    expect(await run(confirmNewsletter("nope"))).toBe("invalid");
    const stale = signNewsletterToken(secret, "confirm", "a@b.co", { now: 0, ttlSeconds: 1 });
    expect(await run(confirmNewsletter(stale))).toBe("expired");
    expect(calls.subscribe).toHaveLength(1);
  });

  it("unsubscribes with an unsubscribe token only", async () => {
    const { calls, run } = setup();
    const leave = signNewsletterToken(secret, "unsubscribe", "a@b.co");
    expect(await run(unsubscribeNewsletter(leave))).toBe("done");
    expect(calls.unsubscribe).toEqual(["a@b.co"]);
    const confirm = signNewsletterToken(secret, "confirm", "a@b.co", { ttlSeconds: 60 });
    expect(await run(unsubscribeNewsletter(confirm))).toBe("invalid");
  });

  it("says unavailable when the list cannot be reached", async () => {
    const { run } = setup({ gateway: "not_configured" });
    const leave = signNewsletterToken(secret, "unsubscribe", "a@b.co");
    expect(await run(unsubscribeNewsletter(leave))).toBe("unavailable");
  });
});
