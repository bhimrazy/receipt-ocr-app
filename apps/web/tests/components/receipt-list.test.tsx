import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewBadge } from "@/components/receipt-list";

const badge = (receipt: {
  reviewReasons: string[];
  reviewedAt: Date | null;
  reviewerName?: string | null;
}) => renderToStaticMarkup(<ReviewBadge receipt={receipt} />);

describe("ReviewBadge", () => {
  it("shows Checked, with who checked it, in place of Needs review", () => {
    const html = badge({ reviewReasons: ["no_date"], reviewedAt: new Date(), reviewerName: "Ana" });
    expect(html).toContain("Checked by Ana");
    expect(html).not.toContain("Needs review");
  });

  it("shows Checked for a reviewed receipt whose reviewer was deleted", () => {
    expect(badge({ reviewReasons: [], reviewedAt: new Date(), reviewerName: null })).toContain(
      "Checked",
    );
  });

  it("shows Needs review exactly when the receipt is in the Needs review filter", () => {
    expect(badge({ reviewReasons: ["totals_mismatch"], reviewedAt: null })).toContain(
      "Needs review",
    );
  });

  it("shows nothing for a receipt that passed its checks", () => {
    expect(badge({ reviewReasons: [], reviewedAt: null })).toBe("");
  });
});
