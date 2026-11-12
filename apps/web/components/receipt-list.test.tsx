import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewBadge } from "./receipt-list";

const badge = (receipt: {
  confidence: number | null;
  reviewedAt: Date | null;
  reviewerName?: string | null;
}) => renderToStaticMarkup(<ReviewBadge receipt={receipt} />);

describe("ReviewBadge", () => {
  it("shows Checked, with who checked it, in place of the confidence tier", () => {
    const html = badge({ confidence: 0.5, reviewedAt: new Date(), reviewerName: "Ana Test" });
    expect(html).toContain("Checked by Ana Test");
    expect(html).not.toContain("Review");
  });

  it("shows Checked for a reviewed receipt whose reviewer was deleted", () => {
    expect(badge({ confidence: 0.99, reviewedAt: new Date(), reviewerName: null })).toContain(
      "Checked",
    );
  });

  it("shows the confidence tier until someone reviews a doubtful read", () => {
    expect(badge({ confidence: 0.5, reviewedAt: null })).toContain("Review");
  });

  it("shows nothing for a confident read nobody checked", () => {
    expect(badge({ confidence: 0.99, reviewedAt: null })).toBe("");
  });
});
