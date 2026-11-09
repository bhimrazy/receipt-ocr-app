import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cancelPaddleSubscription,
  createPaddleCheckoutTransaction,
  createPaddlePortalSession,
  PaddleApiError,
  PADDLE_ERROR_CODES,
  paddleErrorCode,
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

  it("keeps an adjustment's ids, action, type and status, nothing else", () => {
    const event = parsePaddleEvent(
      JSON.stringify({
        event_id: "evt_3",
        event_type: "adjustment.updated",
        occurred_at: "2026-11-08T12:00:00Z",
        data: {
          id: "adj_1",
          action: "chargeback",
          type: "full",
          status: "approved",
          transaction_id: "txn_1",
          subscription_id: "sub_1",
          customer_id: "ctm_1",
          reason: "fraud",
          totals: { total: "900" },
          updated_at: "2026-11-08T12:00:00Z",
        },
      }),
    );
    expect(event).toEqual({
      provider: "paddle",
      eventId: "evt_3",
      type: "adjustment.updated",
      occurredAt: new Date("2026-11-08T12:00:00Z"),
      subscription: null,
      adjustment: {
        adjustmentId: "adj_1",
        action: "chargeback",
        type: "full",
        status: "approved",
        subscriptionId: "sub_1",
        transactionId: "txn_1",
      },
    });
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

/** A fake fetch that answers each call in turn and records what was asked. */
const scripted = (...answers: Response[]) => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error("unexpected call");
    return answer;
  }) as unknown as typeof fetch;
  return { calls, fake };
};

describe("createPaddleCheckoutTransaction", () => {
  const options = {
    environment: "sandbox" as const,
    apiKey: "pdl_sdbx_apikey_test",
    priceId: "pri_month",
    email: "a+b@example.com",
    customData: { workspaceId: "org_1", userId: "user_1" },
  };

  it("reuses the customer with that email and creates the transaction with our price and custom data", async () => {
    const { calls, fake } = scripted(
      Response.json({ data: [{ id: "ctm_1" }] }),
      Response.json({ data: { id: "txn_1", status: "draft" } }, { status: 201 }),
    );
    expect(await createPaddleCheckoutTransaction(options, fake)).toEqual({
      transactionId: "txn_1",
    });
    expect(calls).toEqual([
      {
        url: "https://sandbox-api.paddle.com/customers?email=a%2Bb%40example.com",
        method: "GET",
        body: undefined,
      },
      {
        url: "https://sandbox-api.paddle.com/transactions",
        method: "POST",
        body: {
          items: [{ price_id: "pri_month", quantity: 1 }],
          customer_id: "ctm_1",
          custom_data: { workspaceId: "org_1", userId: "user_1" },
        },
      },
    ]);
  });

  it("creates the customer when none has that email, and throws on an error status", async () => {
    const first = scripted(
      Response.json({ data: [] }),
      Response.json({ data: { id: "ctm_new" } }, { status: 201 }),
      Response.json({ data: { id: "txn_2" } }, { status: 201 }),
    );
    expect(await createPaddleCheckoutTransaction(options, first.fake)).toEqual({
      transactionId: "txn_2",
    });
    expect(first.calls[1]).toMatchObject({
      url: "https://sandbox-api.paddle.com/customers",
      body: { email: "a+b@example.com" },
    });
    expect(first.calls[2]?.body).toMatchObject({ customer_id: "ctm_new" });

    const failing = scripted(new Response("{}", { status: 500 }));
    await expect(createPaddleCheckoutTransaction(options, failing.fake)).rejects.toBeInstanceOf(
      PaddleApiError,
    );
  });
});

describe("Paddle error codes", () => {
  // Paddle's error body: https://developer.paddle.com/api-reference/about/errors
  const errorBody = (code: unknown) => ({
    error: {
      type: "request_error",
      code,
      detail: "Cannot create a transaction for ctm_01h for a@example.com",
      documentation_url: "https://developer.paddle.com/errors/x",
    },
    meta: { request_id: "9346b365-4cad-43a6-b7c1-48ff6a1c7836" },
  });

  it("keeps the code from the error body on the thrown error", async () => {
    const { fake } = scripted(
      Response.json({ data: [{ id: "ctm_1" }] }),
      Response.json(errorBody("transaction_default_checkout_url_not_set"), { status: 400 }),
    );
    const error = await createPaddleCheckoutTransaction(
      {
        environment: "sandbox",
        apiKey: "k",
        priceId: "pri_m",
        email: "a@example.com",
        customData: { workspaceId: "org_1", userId: "user_1" },
      },
      fake,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaddleApiError);
    expect(error).toMatchObject({ status: 400, code: "transaction_default_checkout_url_not_set" });
    expect(String((error as Error).message)).not.toContain("a@example.com");
  });

  it("is null without a code, and maps any code not on the list to other", async () => {
    const { fake } = scripted(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(
      cancelPaddleSubscription({ environment: "sandbox", apiKey: "k", subscriptionId: "s" }, fake),
    ).rejects.toMatchObject({ status: 502, code: null });
    for (const body of [
      null,
      "text",
      {},
      { error: null },
      { error: "not_found" },
      errorBody(null),
    ]) {
      expect(paddleErrorCode(body), JSON.stringify(body)).toBeNull();
    }
    for (const code of [
      42,
      "Not found: sub_1",
      "a@example.com",
      "x".repeat(81),
      "some_new_paddle_code",
      "constructor",
    ]) {
      expect(paddleErrorCode(errorBody(code)), String(code)).toBe("other");
    }
    for (const code of PADDLE_ERROR_CODES) expect(paddleErrorCode(errorBody(code))).toBe(code);
  });
});

describe("cancelPaddleSubscription", () => {
  it("cancels immediately", async () => {
    const { calls, fake } = scripted(Response.json({ data: { id: "sub_1", status: "canceled" } }));
    await cancelPaddleSubscription(
      { environment: "production", apiKey: "k", subscriptionId: "sub_1" },
      fake,
    );
    expect(calls).toEqual([
      {
        url: "https://api.paddle.com/subscriptions/sub_1/cancel",
        method: "POST",
        body: { effective_from: "immediately" },
      },
    ]);
  });
});
