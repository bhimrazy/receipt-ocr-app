import { describe, expect, it } from "vitest";
import type { Usage } from "@/components/usage-meter";
import { meterAction } from "@/lib/meter-action";

const usage = (used: number, over: Partial<Usage> = {}) => ({
  period: "month" as const,
  used,
  limit: 50,
  blocked: null,
  ...over,
});
const free = (u: ReturnType<typeof usage>, audience: "owner" | "member" | null = "owner") =>
  meterAction({ usage: u, plan: "free", owner: audience === "owner", audience });

describe("meterAction on Free", () => {
  it("offers nothing under 80% of the month, even with today nearly used", () => {
    expect(free(usage(9))).toBeNull();
    expect(free(usage(25))).toBeNull();
  });

  it("links the upgrade from 80% of the month, a used-up day and a full pool", () => {
    expect(free(usage(40))).toBe("upgrade-link");
    expect(free(usage(30, { blocked: "day" }))).toBe("upgrade-link");
    expect(free(usage(9, { blocked: "pool" }))).toBe("upgrade-link");
  });

  it("gives the button only once the month is used up", () => {
    expect(free(usage(50, { blocked: "month" }))).toBe("upgrade-button");
    expect(free(usage(20, { period: "day", limit: 20, blocked: "day" }))).toBe("upgrade-button");
  });

  it("tells a member to ask the owner, but says nothing about the pool", () => {
    expect(free(usage(40), "member")).toBe("ask-owner");
    expect(free(usage(50, { blocked: "month" }), "member")).toBe("ask-owner");
    expect(free(usage(9, { blocked: "pool" }), "member")).toBeNull();
  });

  it("says Pro opens soon while checkout is closed to the viewer", () => {
    expect(free(usage(50, { blocked: "month" }), null)).toBe("opens-soon");
  });

  it("offers nothing while scanning is paused for everyone", () => {
    expect(free(usage(50, { blocked: "global" }))).toBeNull();
  });
});

describe("meterAction on Pro", () => {
  const pro = (u: ReturnType<typeof usage>, owner: boolean) =>
    meterAction({ usage: u, plan: "pro", owner, audience: null });

  it("gives the owner Contact us at a used-up month, and nothing before", () => {
    expect(pro(usage(500, { limit: 500, blocked: "month" }), true)).toBe("contact");
    expect(pro(usage(450, { limit: 500 }), true)).toBeNull();
    expect(pro(usage(300, { limit: 500, blocked: "day" }), true)).toBeNull();
  });

  it("gives members nothing", () => {
    expect(pro(usage(500, { limit: 500, blocked: "month" }), false)).toBeNull();
  });
});
