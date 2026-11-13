import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuideSteps } from "@/components/install-guide";

const html = (browser: "safari" | "chrome" | "other", ipad = false) =>
  renderToStaticMarkup(<GuideSteps path={{ kind: "guide", browser, ipad }} />);

describe("GuideSteps", () => {
  it("on iPhone Safari names ••• (iOS 26 Compact) or Share, then Add, with the Open as Web App note", () => {
    const steps = html("safari");
    expect(steps).toContain("•••");
    expect(steps).toContain("Add to Home Screen");
    expect(steps).toContain("Open as Web App");
    expect(steps.match(/<li/g)).toHaveLength(3);
  });

  it("on iPad Safari points at Share in the toolbar, in two steps", () => {
    const steps = html("safari", true);
    expect(steps).toContain("in the toolbar");
    expect(steps).not.toContain("•••");
    expect(steps.match(/<li/g)).toHaveLength(2);
  });

  it("sends Chrome and in-app browsers to Safari", () => {
    for (const browser of ["chrome", "other"] as const) {
      expect(html(browser)).toContain("Open this page in Safari");
      expect(html(browser)).not.toContain("<li");
    }
  });
});
