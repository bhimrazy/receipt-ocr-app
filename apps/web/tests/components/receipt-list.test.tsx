import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewBadge } from "@/components/receipt-list";

const badge = (receipt: {
  reviewReasons: string[];
  reviewedAt: Date | null;
  reviewerName?: string | null;
}) => renderToStaticMarkup(<ReviewBadge receipt={receipt} />);

describe("ReviewBadge", () => {
  it("shows Reviewed, with who reviewed it, in place of Needs review", () => {
    const html = badge({ reviewReasons: ["no_date"], reviewedAt: new Date(), reviewerName: "Ana" });
    expect(html).toContain("Reviewed by Ana");
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Checked");
  });

  it("shows Reviewed for a reviewed receipt whose reviewer was deleted", () => {
    const html = badge({ reviewReasons: [], reviewedAt: new Date(), reviewerName: null });
    expect(html).toContain(">Reviewed</span>");
    expect(html).not.toContain("Reviewed by");
  });

  it("shows Needs review exactly when the receipt is in the Needs review filter", () => {
    expect(badge({ reviewReasons: ["totals_mismatch"], reviewedAt: null })).toContain(
      "Needs review",
    );
  });

  it("is never blank: a receipt that passed its checks and nobody reviewed is Not reviewed", () => {
    const html = badge({ reviewReasons: [], reviewedAt: null });
    expect(html).toContain("Not reviewed");
    expect(html).not.toContain("Looks fine");
  });

  it("shows Possible duplicate beside the state, reviewed or not", () => {
    expect(badge({ reviewReasons: ["possible_duplicate"], reviewedAt: null })).toMatch(
      /Needs review.*Possible duplicate/,
    );
    expect(
      badge({ reviewReasons: ["possible_duplicate"], reviewedAt: new Date(), reviewerName: "Ana" }),
    ).toMatch(/Reviewed by Ana.*Possible duplicate/);
  });
});
