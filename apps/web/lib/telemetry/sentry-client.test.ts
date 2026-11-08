import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
  eventFiltersIntegration: vi.fn((options: unknown) => ({ name: "EventFilters", options })),
}));
vi.mock("@sentry/browser", () => ({
  BrowserClient: class {
    constructor(options: Record<string, unknown>) {
      sdk.options = options;
    }
    init() {}
  },
  breadcrumbsIntegration: () => ({ name: "Breadcrumbs" }),
  captureException: vi.fn(),
  dedupeIntegration: () => ({ name: "Dedupe" }),
  defaultStackParser: () => [],
  eventFiltersIntegration: sdk.eventFiltersIntegration,
  getCurrentScope: () => ({ setClient: () => {} }),
  globalHandlersIntegration: () => ({ name: "GlobalHandlers" }),
  makeFetchTransport: () => ({}),
}));

describe("startSentryClient", () => {
  it("keeps Sentry's default ignore list and only reports errors from our own scripts", async () => {
    vi.stubGlobal("self", { location: { origin: "https://receipt-ocr.example" } });
    const { startSentryClient } = await import("./sentry-client");
    startSentryClient("https://key@o1.ingest.us.sentry.io/2");
    expect(sdk.eventFiltersIntegration).toHaveBeenCalledWith({
      allowUrls: ["https://receipt-ocr.example"],
    });
    const names = (sdk.options?.integrations as { name: string }[]).map((i) => i.name);
    expect(names).toContain("EventFilters");
    vi.unstubAllGlobals();
  });
});
