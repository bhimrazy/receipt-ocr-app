import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MORE_SECTIONS, TAB_SECTIONS } from "@/app/admin/admin-nav";
import { APP_NAV, backFor, isActive, tabItems, type NavItem } from "./app-nav";
import type { MobileTabs } from "./mobile-tabs";

const appDir = join(__dirname, "..", "app");

/** Every signed-in page route, from the app directory ("[id]" segments filled in). */
function routes(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routes(path, `${base}/${name}`);
    return name === "page.tsx" ? [(base || "/").replace(/\[[^\]]+\]/g, "abc")] : [];
  });
}

const signedIn = [
  ...routes(join(appDir, "app"), "/app"),
  ...routes(join(appDir, "admin"), "/admin"),
];
const scan: NavItem = { href: "/app/upload", label: "Scan", icon: APP_NAV[0]!.icon };

// Redirect-only pages never render.
const redirects = new Set(["/admin/organizations"]);

describe("phone navigation", () => {
  it("finds the signed-in routes", () => {
    expect(signedIn.length).toBeGreaterThan(10);
  });

  describe.each<MobileTabs>(["five", "three"])("%s-tab bar", (tabs) => {
    it.each(signedIn.filter((r) => !redirects.has(r)))(
      "%s has Back or a highlighted tab",
      (route) => {
        const items = route.startsWith("/admin")
          ? [...TAB_SECTIONS, ...MORE_SECTIONS]
          : // Settings has no tab in "three"; the account sheet carries it.
            [...tabItems(tabs), scan, ...(tabs === "three" ? [APP_NAV[3]!] : [])];
        expect(
          backFor(route, tabs) !== null || items.some((item) => isActive(route, item, tabs)),
        ).toBe(true);
      },
    );

    it("has as many tabs left of Scan as right", () => {
      expect(tabItems(tabs).length % 2).toBe(0);
    });
  });

  it("keeps the admin tab bar to five slots", () => {
    expect(TAB_SECTIONS.length + 1).toBeLessThanOrEqual(5);
  });

  it("gives Groups its own tab with five tabs", () => {
    const groups = APP_NAV.find((i) => i.href === "/app/groups")!;
    const history = APP_NAV.find((i) => i.href === "/app/history")!;
    expect(backFor("/app/groups", "five")).toBeNull();
    expect(isActive("/app/groups", groups, "five")).toBe(true);
    expect(isActive("/app/groups", history, "five")).toBe(false);
  });

  it("keeps Groups under History with three tabs", () => {
    const history = APP_NAV.find((i) => i.href === "/app/history")!;
    expect(backFor("/app/groups", "three")).toEqual({ href: "/app/history", label: "History" });
    expect(isActive("/app/groups", history, "three")).toBe(true);
  });

  it("highlights no sidebar row on the upload page", () => {
    expect(APP_NAV.some((item) => isActive("/app/upload", item))).toBe(false);
  });
});
