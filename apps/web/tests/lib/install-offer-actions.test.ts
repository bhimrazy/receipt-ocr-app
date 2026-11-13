import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveScope } from "@/lib/session";
import { setProductEventSender, type ProductEvent } from "@/lib/telemetry/analytics";

let scope: ActiveScope | null = null;
vi.mock("@/lib/session", () => ({ getActiveScope: async () => scope }));

const { recordInstallOffer } = await import("@/lib/install-offer-actions");

const sent: ProductEvent[] = [];
beforeEach(() => {
  sent.length = 0;
  setProductEventSender((event) => sent.push(event));
  scope = { organizationId: "org_1", userId: "u_1", role: "owner" };
});
afterEach(() => setProductEventSender(undefined));

describe("recordInstallOffer", () => {
  it("sends install_offer with action, surface and platform only", async () => {
    await recordInstallOffer({ action: "shown", surface: "card", platform: "ios_safari" });
    expect(sent).toEqual([
      {
        name: "install_offer",
        userId: "u_1",
        workspaceId: "org_1",
        props: { action: "shown", surface: "card", platform: "ios_safari", workspace_id: "org_1" },
      },
    ]);
  });

  it("drops values outside the vocabulary", async () => {
    await recordInstallOffer({ action: "clicked", surface: "card", platform: "chromium" } as never);
    await recordInstallOffer({ action: "shown", surface: "/app/x", platform: "chromium" } as never);
    await recordInstallOffer(null as never);
    expect(sent).toEqual([]);
  });

  it("sends nothing signed out or while an admin impersonates", async () => {
    scope = null;
    await recordInstallOffer({ action: "shown", surface: "menu", platform: "chromium" });
    scope = { organizationId: "org_1", userId: "u_1", role: "owner", impersonatedBy: "admin_1" };
    await recordInstallOffer({ action: "shown", surface: "menu", platform: "chromium" });
    expect(sent).toEqual([]);
  });
});
