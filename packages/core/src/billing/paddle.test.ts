import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPaddlePortalSession,
  PaddleApiError,
  parsePaddleEvent,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyPaddleSignature,
} from "./paddle";

const secret = "pdl_ntfset_test_secret";
const nowMs = Date.UTC(2026, 10, 8, 12, 0, 0);
const ts = Math.floor(nowMs / 1000);
const sign = (body: string, at = ts, key = secret) =>
  `ts=${at};h1=${createHmac("sha256", key).update(`${at}:${body}`).digest("hex")}`;

const subscriptionBody = (
  overrides: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
) =>
  JSON.stringify({
    event_id: "evt_01hv8x2a7mc9w5b4ytm2z1k0aa",
    event_type: "subscription.updated",
    occurred_at: "2026-11-08T12:00:00.123456Z",
    notification_id: "ntf_01hv8x2a7mc9w5b4ytm2z1k0ab",
    data: {
      id: "sub_01hv8x2a7mc9w5b4ytm2z1k0ac",
      status: "active",
      customer_id: "ctm_01hv8x2a7mc9w5b4ytm2z1k0ad",
      custom_data: { workspaceId: "org_1", userId: "user_1" },
      items: [{ price: { id: "pri_month" }, quantity: 1 }],
      billing_cycle: { interval: "month", frequency: 1 },
      current_billing_period: {
        starts_at: "2026-11-08T12:00:00Z",
        ends_at: "2026-12-08T12:00:00Z",
      },
      scheduled_change: null,
      canceled_at: null,
      updated_at: "2026-11-08T12:00:00.654321Z",
      ...data,
    },
    ...overrides,
  });

describe("verifyPaddleSignature", () => {
  const body = subscriptionBody();

  it("accepts Paddle's ts/h1 HMAC-SHA256 over `ts:body`", () => {
    expect(verifyPaddleSignature(body, sign(body), secret, nowMs)).toBe("ok");
  });

  it("accepts any matching h1, for secret rotation", () => {
    const good = sign(body).split(";")[1]!;
    expect(
      verifyPaddleSignature(body, `ts=${ts};h1=${"0".repeat(64)};${good}`, secret, nowMs),
    ).toBe("ok");
  });

  it("refuses a missing, malformed or wrong signature", () => {
    expect(verifyPaddleSignature(body, null, secret, nowMs)).toBe("missing-signature");
    expect(verifyPaddleSignature(body, "garbage", secret, nowMs)).toBe("bad-signature");
    expect(verifyPaddleSignature(body, `ts=${ts}`, secret, nowMs)).toBe("bad-signature");
    expect(verifyPaddleSignature(body, `ts=${ts};h1=zz`, secret, nowMs)).toBe("bad-signature");
    expect(verifyPaddleSignature(body, sign(body, ts, "other-secret"), secret, nowMs)).toBe(
      "bad-signature",
    );
  });

  it("refuses a body changed after signing, even by whitespace", () => {
    expect(verifyPaddleSignature(`${body} `, sign(body), secret, nowMs)).toBe("bad-signature");
  });

  it("refuses a timestamp outside the tolerance, either way", () => {
    const old = ts - SIGNATURE_TOLERANCE_SECONDS - 1;
    const ahead = ts + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(verifyPaddleSignature(body, sign(body, old), secret, nowMs)).toBe("stale-signature");
    expect(verifyPaddleSignature(body, sign(body, ahead), secret, nowMs)).toBe("stale-signature");
    const edge = ts - SIGNATURE_TOLERANCE_SECONDS;
    expect(verifyPaddleSignature(body, sign(body, edge), secret, nowMs)).toBe("ok");
  });
});

describe("parsePaddleEvent", () => {
  it("maps a subscription event to the provider-neutral snapshot", () => {
    const event = parsePaddleEvent(subscriptionBody());
    expect(event).toMatchObject({
      provider: "paddle",
      eventId: "evt_01hv8x2a7mc9w5b4ytm2z1k0aa",
      type: "subscription.updated",
      subscription: {
        subscriptionId: "sub_01hv8x2a7mc9w5b4ytm2z1k0ac",
        customerId: "ctm_01hv8x2a7mc9w5b4ytm2z1k0ad",
        status: "active",
        priceId: "pri_month",
        interval: "month",
        cancelAtPeriodEnd: false,
        workspaceId: "org_1",
        userId: "user_1",
      },
    });
    if (!event || event === "bad-body") throw new Error("expected an event");
    expect(event.subscription?.currentPeriodEnd?.toISOString()).toBe("2026-12-08T12:00:00.000Z");
    expect(event.subscription?.updatedAt.toISOString()).toBe("2026-11-08T12:00:00.654Z");
  });

  it("reads a scheduled cancel as cancel at period end", () => {
    const event = parsePaddleEvent(
      subscriptionBody(
        {},
        { scheduled_change: { action: "cancel", effective_at: "2026-12-08T12:00:00Z" } },
      ),
    );
    expect(event).toMatchObject({ subscription: { status: "active", cancelAtPeriodEnd: true } });
  });

  it("reads a yearly price and missing custom data", () => {
    const event = parsePaddleEvent(
      subscriptionBody(
        {},
        { billing_cycle: { interval: "year", frequency: 1 }, custom_data: null },
      ),
    );
    expect(event).toMatchObject({
      subscription: { interval: "year", workspaceId: null, userId: null },
    });
  });

  it("keeps a completed transaction without subscription state", () => {
    const event = parsePaddleEvent(
      JSON.stringify({
        event_id: "evt_2",
        event_type: "transaction.completed",
        occurred_at: "2026-11-08T12:00:00Z",
        data: { id: "txn_1" },
      }),
    );
    expect(event).toMatchObject({ type: "transaction.completed", subscription: null });
  });

  it("drops event types we don't subscribe to, and refuses shapes it can't read", () => {
    expect(parsePaddleEvent(subscriptionBody({ event_type: "customer.updated" }))).toBeNull();
    expect(parsePaddleEvent("not json")).toBe("bad-body");
    expect(parsePaddleEvent(JSON.stringify({ event_type: "subscription.updated" }))).toBe(
      "bad-body",
    );
    expect(parsePaddleEvent(subscriptionBody({}, { status: "deleted" }))).toBe("bad-body");
  });
});

describe("createPaddlePortalSession", () => {
  const options = {
    environment: "sandbox" as const,
    apiKey: "pdl_sdbx_apikey_test",
    customerId: "ctm_1",
    subscriptionId: "sub_1",
  };

  it("posts to the sandbox API with the key and returns the portal links", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json(
        {
          data: {
            urls: {
              general: { overview: "https://sandbox-customer-portal.paddle.com/cpl_1?token=t" },
              subscriptions: [
                {
                  id: "sub_1",
                  cancel_subscription: "https://sandbox-customer-portal.paddle.com/cancel?token=t",
                  update_subscription_payment_method:
                    "https://sandbox-customer-portal.paddle.com/pay?token=t",
                },
              ],
            },
          },
        },
        { status: 201 },
      );
    }) as unknown as typeof fetch;
    const links = await createPaddlePortalSession(options, fake);
    expect(seen?.url).toBe("https://sandbox-api.paddle.com/customers/ctm_1/portal-sessions");
    expect(new Headers(seen?.init.headers).get("authorization")).toBe(
      "Bearer pdl_sdbx_apikey_test",
    );
    expect(JSON.parse(String(seen?.init.body))).toEqual({ subscription_ids: ["sub_1"] });
    expect(links).toEqual({
      overview: "https://sandbox-customer-portal.paddle.com/cpl_1?token=t",
      cancel: "https://sandbox-customer-portal.paddle.com/cancel?token=t",
      updatePaymentMethod: "https://sandbox-customer-portal.paddle.com/pay?token=t",
    });
  });

  it("uses the live API in production and throws on an error status", async () => {
    let url = "";
    const fake = (async (u: string) => {
      url = u;
      return new Response("{}", { status: 403 });
    }) as unknown as typeof fetch;
    await expect(
      createPaddlePortalSession({ ...options, environment: "production" }, fake),
    ).rejects.toBeInstanceOf(PaddleApiError);
    expect(url.startsWith("https://api.paddle.com/")).toBe(true);
  });
});
