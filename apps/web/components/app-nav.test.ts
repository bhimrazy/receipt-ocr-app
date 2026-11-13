import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MORE_SECTIONS, TAB_SECTIONS } from "@/app/admin/admin-nav";
import { APP_NAV, backFor, isActive, type NavItem } from "./app-nav";

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

  it.each(signedIn.filter((r) => !redirects.has(r)))(
    "%s has Back or a highlighted tab",
    (route) => {
      const items = route.startsWith("/admin")
        ? [...TAB_SECTIONS, ...MORE_SECTIONS]
        : [...APP_NAV, scan];
      expect(backFor(route) !== null || items.some((item) => isActive(route, item))).toBe(true);
    },
  );

  it("keeps the admin tab bar to five slots", () => {
    expect(TAB_SECTIONS.length + 1).toBeLessThanOrEqual(5);
  });

  it("puts receipt pages and Groups under Receipts", () => {
    const receipts = APP_NAV.find((i) => i.href === "/app/receipts")!;
    for (const path of ["/app/receipts", "/app/receipts/groups", "/app/receipts/abc"]) {
      expect(APP_NAV.filter((item) => isActive(path, item))).toEqual([receipts]);
    }
    expect(backFor("/app/receipts")).toBeNull();
    expect(backFor("/app/receipts/groups")).toEqual({ href: "/app/receipts", label: "Receipts" });
    expect(backFor("/app/receipts/abc")).toEqual({ href: "/app/receipts", label: "Receipts" });
  });

  it("highlights no sidebar row on the upload page", () => {
    expect(APP_NAV.some((item) => isActive("/app/upload", item))).toBe(false);
  });
});
