/**
 * One upload through the real route, core and Postgres, with the fixture OCR
 * provider: it must write exactly one request event and one job-attempt
 * event, with the ids, timings, OCR fields and no customer data. Skipped
 * unless INTEGRATION=1; needs DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL,
 * S3_* and OCR_PROVIDER=fixture (see scripts/test.sh).
 */
import { FIXTURE_RECEIPTS } from "@receipt-ocr/ai";
import { createDb, eq, organization, user } from "@receipt-ocr/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const tag = `int-events-${Date.now()}`;
const email = `${tag}@example.com`;
const state = vi.hoisted(() => ({
  scope: null as null | { organizationId: string; userId: string; role: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  getSession: async () =>
    state.scope && { user: { id: state.scope.userId, email }, session: { impersonatedBy: null } },
  getActiveScope: async () => state.scope,
}));

describe.skipIf(!enabled)("wide events for one upload", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");

  beforeAll(async () => {
    const { ensurePersonalWorkspace } = await import("@receipt-ocr/core");
    const { runtime } = await import("./runtime");
    await db.insert(user).values({ id: tag, name: "Jane Doe", email, emailVerified: true });
    const organizationId = await runtime.runPromise(
      ensurePersonalWorkspace({ id: tag, name: "Jane Doe", email }),
    );
    if (!organizationId) throw new Error("no workspace");
    state.scope = { organizationId, userId: tag, role: "owner" };
  });

  afterAll(async () => {
    const { purgeReceiptFiles } = await import("@receipt-ocr/core");
    const { runtime } = await import("./runtime");
    if (state.scope) {
      await runtime.runPromise(purgeReceiptFiles({ organizationId: state.scope.organizationId }));
      await db.delete(organization).where(eq(organization.id, state.scope.organizationId));
    }
    await db.delete(user).where(eq(user.id, tag));
  });

  it("writes one request event and one job.attempt event, with no PII", async () => {
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line) => lines.push(String(line)));
    const error = vi.spyOn(console, "error").mockImplementation((line) => lines.push(String(line)));
    const { POST } = await import("@/app/api/receipts/route");
    const form = new FormData();
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
    form.set("file", new File([jpeg], "Jane Doe pharmacy receipt.jpg", { type: "image/jpeg" }));
    const response = await POST(
      new Request(`${process.env.BETTER_AUTH_URL}/api/receipts`, {
        method: "POST",
        headers: { origin: new URL(process.env.BETTER_AUTH_URL ?? "").origin },
        body: form,
      }),
    );
    info.mockRestore();
    error.mockRestore();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { receiptId: string; requestId: string };

    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.map((e) => e.event).sort()).toEqual(["job.attempt", "receipt.upload"]);
    const request = events.find((e) => e.event === "receipt.upload")!;
    const attempt = events.find((e) => e.event === "job.attempt")!;

    expect(request).toMatchObject({
      level: "info",
      unit: "request",
      route: "/api/receipts",
      method: "POST",
      status_code: 200,
      outcome: "success",
      request_id: body.requestId,
      user_id: tag,
      organization_id: state.scope!.organizationId,
      receipt_id: body.receiptId,
      mode: "instant",
      plan: expect.any(String),
      file: { size_bytes: jpeg.length, media_type: "image/jpeg" },
      timings_ms: { "storage.put": expect.any(Number), "db.insert": expect.any(Number) },
    });
    expect(attempt).toMatchObject({
      level: "info",
      unit: "job_attempt",
      request_id: body.requestId,
      trigger: "upload",
      receipt_id: body.receiptId,
      job_id: request.job_id,
      user_id: tag,
      organization_id: state.scope!.organizationId,
      attempt: 1,
      round: 1,
      outcome: "succeeded",
      queue: { kind: "receipt.extract", outcome: "succeeded", wait_ms: expect.any(Number) },
      ocr: { model: "fixture", calls: 1, fallback: false, items_count: expect.any(Number) },
      timings_ms: {
        "storage.get": expect.any(Number),
        "ai.extract": expect.any(Number),
        "db.complete": expect.any(Number),
      },
    });
    for (const event of events) {
      expect(event).toHaveProperty("version");
      expect(event).not.toHaveProperty("dropped_fields");
    }

    const text = lines.join("\n");
    const forbidden = [
      email,
      "Jane",
      "pharmacy",
      ...FIXTURE_RECEIPTS.flatMap((r) => [r.merchant, ...r.items.map((i) => i.name)]),
    ];
    for (const value of forbidden) if (value) expect(text).not.toContain(value);
  });
});
