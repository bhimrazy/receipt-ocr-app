import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, requestIdFor } from "./request-id";

const PROXY_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("requestIdFor", () => {
  it("uses the proxy's id on /app and /admin, where proxy.ts replaces the client's", () => {
    expect(requestIdFor("/app/receipts/[id]", { [REQUEST_ID_HEADER]: PROXY_ID })).toBe(PROXY_ID);
    expect(requestIdFor("/admin", { [REQUEST_ID_HEADER]: PROXY_ID })).toBe(PROXY_ID);
  });

  it("ignores a client-sent id everywhere else", () => {
    for (const route of ["/api/receipts", "/", "/application", "/sign-in"]) {
      const id = requestIdFor(route, { [REQUEST_ID_HEADER]: "jane@example.com" });
      expect(id).not.toBe("jane@example.com");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
