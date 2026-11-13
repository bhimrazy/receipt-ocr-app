import { createTransport } from "@sentry/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { errorFields } from "@receipt-ocr/core/telemetry";
import { reportError, setErrorReporter } from "@/lib/telemetry/errors";
import { framesOf, startSentryServer, syntheticError } from "@/lib/telemetry/sentry-server";

vi.mock("server-only", () => ({}));

const DSN = "https://0123456789abcdef0123456789abcdef@o1.ingest.us.sentry.io/2";
const envelopes: string[] = [];

/** An AI SDK failure as it really arrives: the receipt in the message, the cause chain and `.text`. */
function providerFailure() {
  const validation = new Error(
    'Type validation failed: Value: {"merchant":"Dr Smith Clinic","total":9.5}',
  );
  validation.name = "AI_TypeValidationError";
  const error = new Error("No object generated: response did not match schema.", {
    cause: validation,
  });
  error.name = "AI_NoObjectGeneratedError";
  Object.assign(error, { text: '{"merchant":"Dr Smith Clinic"}' });
  return error;
}

beforeAll(async () => {
  startSentryServer(
    DSN,
    { VERCEL_GIT_COMMIT_SHA: "9bd27c4aaaa", VERCEL_ENV: "production" },
    (options) =>
      createTransport(options, async (request) => {
        envelopes.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  );
});

afterAll(() => setErrorReporter(undefined));

describe("Sentry on the server", () => {
  it("sends a stand-in error: our fields and the frames, never the message or causes (security plan B1)", async () => {
    const error = providerFailure();
    const fields = { ...errorFields(error), type: "OcrError", kind: "invalid-output" };
    reportError({
      error,
      fields,
      tags: {
        route: "/api/receipts",
        method: "POST",
        request_id: "0f8fad5b-d9cb-469f-a165-70867728950e",
        status_code: 502,
      },
    });
    const { flush } = await import("@sentry/node");
    await flush(2_000);
    const sent = envelopes.join("\n");
    expect(sent).toContain('"type":"OcrError"');
    expect(sent).toContain('"value":"invalid-output"');
    expect(sent).toContain('"release":"9bd27c4"');
    expect(sent).toContain('"route":"/api/receipts"');
    for (const leak of [
      "Dr Smith",
      // The key with the value: a bare "9.5" can turn up by chance in the event's timestamp.
      '"total":9.5',
      "Type validation",
      "AI_TypeValidationError",
      "No object generated",
    ]) {
      expect(sent).not.toContain(leak);
    }
  });

  it("keeps frames only, so a multi-line message can't ride along in the stack", () => {
    const error = new Error("line one\nparams: jane@example.com\n  not a frame");
    const frames = framesOf(error);
    expect(frames).not.toContain("jane");
    expect(frames.split("\n").every((line) => /^\s+at /.test(line))).toBe(true);
    expect(syntheticError({ error, fields: { type: "DbError", code: "23505" } }).message).toBe(
      "23505",
    );
  });
});
