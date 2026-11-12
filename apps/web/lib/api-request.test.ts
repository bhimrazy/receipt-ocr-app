import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, OFFLINE_MESSAGE } from "./api-request";

afterEach(() => vi.unstubAllGlobals());

describe("apiRequest", () => {
  it("resolves with the connection message when the request never reaches the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await apiRequest("/api/receipts/r1", "PATCH", { merchant: "x" })).toEqual({
      ok: false,
      error: OFFLINE_MESSAGE,
    });
  });

  it("gives the route's error, else the caller's fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "Total must be a number" }, { status: 400 }))
      .mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    vi.stubGlobal("fetch", fetch);
    expect(await apiRequest("/x", "PATCH", {}, "Couldn't save.")).toEqual({
      ok: false,
      error: "Total must be a number",
    });
    expect(await apiRequest("/x", "DELETE", undefined, "Couldn't delete.")).toEqual({
      ok: false,
      error: "Couldn't delete.",
    });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE", body: undefined });
  });

  it("sends a JSON body and returns the parsed reply", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await apiRequest("/x", "PATCH", { tip: "1" })).toEqual({ ok: true, data: { ok: true } });
    expect(fetch).toHaveBeenCalledWith("/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: '{"tip":"1"}',
    });
  });
});
