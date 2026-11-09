import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveScope } from "./session";
import { setProductEventSender, type ProductEvent } from "./telemetry/analytics";
import { CHECKOUT_VIAS, UPGRADE_SURFACES } from "./upgrade-event";
import type { UpgradeOffer } from "./upgrade-level";

let scope: ActiveScope | null = null;
let offer: Partial<UpgradeOffer> | null = null;
const jar = new Map<string, { value: string; options?: Record<string, unknown> }>();

vi.mock("./session", () => ({ getActiveScope: async () => scope }));
vi.mock("./upgrade-offer", () => ({ getUpgradeOffer: async () => offer }));
vi.mock("./env", () => ({ isProduction: false }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar.get(name),
    set: (name: string, value: string, options: Record<string, unknown>) =>
      jar.set(name, { value, options }),
  }),
}));

const { dismissUpgradeOffer, recordUpgradeOpened } = await import("./upgrade-actions");

const sent: ProductEvent[] = [];
beforeEach(() => {
  sent.length = 0;
  jar.clear();
  setProductEventSender((event) => sent.push(event));
  scope = { organizationId: "org_1", userId: "u_1", role: "owner" };
  offer = {
    level: "near",
    audience: "owner",
    usage: {
      period: "month",
      scope: "user",
      used: 84,
      limit: 100,
      resetsAt: new Date("2026-12-01T00:00:00Z"),
      blocked: null,
      opensAt: new Date("2026-12-01T00:00:00Z"),
    },
  };
});
afterEach(() => setProductEventSender(undefined));

describe("upgrade event vocabulary", () => {
  it("is a closed set; checkouts also start from Billing", () => {
    expect(UPGRADE_SURFACES).toEqual(["home", "meter", "menu", "limit", "banner", "email", "link"]);
    expect(CHECKOUT_VIAS).toEqual([...UPGRADE_SURFACES, "billing"]);
  });
});

describe("recordUpgradeOpened", () => {
  it("sends upgrade_cta with the level read on the server", async () => {
    await recordUpgradeOpened("meter");
    expect(sent).toEqual([
      {
        name: "upgrade_cta",
        userId: "u_1",
        workspaceId: "org_1",
        props: { action: "opened", surface: "meter", level: "near", workspace_id: "org_1" },
      },
    ]);
  });

  it("drops surfaces outside the vocabulary", async () => {
    await recordUpgradeOpened("/app/x" as never);
    await recordUpgradeOpened(null as never);
    expect(sent).toEqual([]);
  });

  it("sends nothing for a member, without an offer, or while an admin impersonates", async () => {
    offer = { ...offer, audience: "member" };
    await recordUpgradeOpened("meter");
    offer = null;
    await recordUpgradeOpened("meter");
    offer = { level: "quiet", audience: "owner" };
    scope = { organizationId: "org_1", userId: "u_1", role: "owner", impersonatedBy: "admin_1" };
    await recordUpgradeOpened("meter");
    expect(sent).toEqual([]);
  });
});

describe("dismissUpgradeOffer", () => {
  it("stores the snooze in an httpOnly cookie on /app and records it", async () => {
    await dismissUpgradeOffer("home");
    const cookie = jar.get("receiptocr.upgrade");
    expect(JSON.parse(cookie!.value).home).toEqual({
      quietDismissals: 0,
      until: Date.parse("2026-12-01T00:00:00Z"),
      level: "near",
    });
    expect(cookie!.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/app" });
    expect(sent[0]?.props).toMatchObject({ action: "dismissed", surface: "home", level: "near" });
  });

  it("ignores other surfaces and people who can't buy", async () => {
    await dismissUpgradeOffer("meter" as never);
    offer = { ...offer, audience: "member" };
    await dismissUpgradeOffer("home");
    expect(jar.size).toBe(0);
    expect(sent).toEqual([]);
  });
});
