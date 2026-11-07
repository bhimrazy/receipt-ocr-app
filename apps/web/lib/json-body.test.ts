import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const { readJson } = await import("./json-body");

const schema = z.object({ name: z.string() });
const post = (body: BodyInit, headers: HeadersInit = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers });

describe("readJson", () => {
  it("parses a small body", async () => {
    expect(await readJson(post('{"name":"a"}'), schema)).toEqual({ data: { name: "a" } });
  });

  it("measures bytes, not characters: multi-byte text over the limit is 413", async () => {
    const body = JSON.stringify({ name: "€".repeat(6000) }); // ~18 KB, 6000 characters
    const result = await readJson(post(body), schema);
    expect("response" in result && result.response.status).toBe(413);
  });

  it("stops a streamed body with no Content-Length once it passes the limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(4096));
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
        if (pulls > 100) controller.close();
      },
    });
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await readJson(request, schema);
    expect("response" in result && result.response.status).toBe(413);
    expect(pulls).toBeLessThan(20);
  });

  it("rejects bad JSON with 400", async () => {
    const result = await readJson(post("{nope"), schema);
    expect("response" in result && result.response.status).toBe(400);
  });
});
