import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "./components/button";

const css = readFileSync(path.join(import.meta.dirname, "styles.css"), "utf8");

describe("touch feedback", () => {
  it.each(["default", "destructive", "secondary", "ghost", "outline", "link"] as const)(
    "%s buttons have a pressed state",
    (variant) => {
      expect(buttonVariants({ variant })).toMatch(/(^| )active:/);
    },
  );

  it("never scales a pressed button under reduced motion", () => {
    for (const variant of ["default", "destructive"] as const) {
      expect(buttonVariants({ variant })).toContain("motion-reduce:active:scale-100");
    }
  });

  it("turns off the long-press callout on app chrome only", () => {
    const rule = css.slice(css.indexOf('[data-slot="tab-bar"] a,'));
    const selectors = rule.slice(0, rule.indexOf("{"));
    expect(selectors).toContain('[data-slot="app-bar"] a');
    expect(selectors).toContain("[data-touch-row]");
    expect(rule.slice(rule.indexOf("{"), rule.indexOf("}"))).toContain(
      "-webkit-touch-callout: none",
    );
  });
});
