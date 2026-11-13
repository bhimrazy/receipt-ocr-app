import type { ReceiptWithItems } from "@receipt-ocr/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ReceiptChecks, ReceiptReviewProvider, ReviewStateBadge, reviewFailure } =
  await import("./receipt-review");

const receipt = (fields: Partial<ReceiptWithItems> = {}) =>
  ({ id: "r1", reviewedAt: null, reviewer: null, ...fields }) as ReceiptWithItems;

const withReview = (receipt: ReceiptWithItems, children: React.ReactNode) =>
  renderToStaticMarkup(
    <ReceiptReviewProvider receipt={receipt} viewerName="Test User">
      {children}
    </ReceiptReviewProvider>,
  );

const render = (props: { receipt: ReceiptWithItems; checks?: string[]; canEdit?: boolean }) =>
  withReview(
    props.receipt,
    <ReceiptChecks
      canEdit={props.canEdit ?? true}
      checks={props.checks ?? ["No date was found."]}
    />,
  );

describe("ReviewStateBadge", () => {
  it("shows Needs review until the receipt is reviewed, then Checked with who checked it", () => {
    const unreviewed = withReview(receipt(), <ReviewStateBadge needsReview />);
    expect(unreviewed).toContain("Needs review");
    expect(unreviewed).not.toContain("Checked");

    const reviewed = withReview(
      receipt({ reviewedAt: new Date("2026-11-10T09:00:00Z"), reviewer: { name: "Test User" } }),
      <ReviewStateBadge needsReview />,
    );
    expect(reviewed).toContain("Checked by Test User");
    expect(reviewed).not.toContain("Needs review");
  });

  it("shows nothing for a receipt that passed its checks", () => {
    expect(withReview(receipt(), <ReviewStateBadge needsReview={false} />)).toBe("");
  });

  it("says Checked without a name once the reviewer's account is gone", () => {
    const html = withReview(
      receipt({ reviewedAt: new Date("2026-11-10T09:00:00Z") }),
      <ReviewStateBadge needsReview />,
    );
    expect(html).toContain(">Checked</span>");
    expect(html).not.toContain("Checked by");
  });
});

describe("ReceiptChecks", () => {
  it("offers Looks right and a dismiss X to editors", () => {
    const html = render({ receipt: receipt() });
    expect(html).toContain("Check before you use this");
    expect(html).toContain("No date was found.");
    expect(html).toContain("Looks right");
    expect(html).toContain('aria-label="Mark as reviewed"');
  });

  it("shows the checks without review controls to someone who can't edit", () => {
    const html = render({ receipt: receipt(), canEdit: false });
    expect(html).toContain("No date was found.");
    expect(html).not.toContain("Looks right");
    expect(html).not.toContain("Mark as reviewed");
  });

  it("replaces the card with who reviewed it and when, with Undo for editors", () => {
    const reviewed = receipt({
      reviewedAt: new Date("2026-11-10T09:00:00Z"),
      reviewer: { name: "Test User" },
    });
    const html = render({ receipt: reviewed });
    expect(html).not.toContain("Check before you use this");
    expect(html).toContain("Reviewed by Test User");
    expect(html).toContain("10 Nov 2026");
    expect(html).toContain(">Undo</button>");
    expect(render({ receipt: reviewed, canEdit: false })).not.toContain("Undo");
  });

  it("says Reviewed without a name once the reviewer's account is gone", () => {
    const html = render({ receipt: receipt({ reviewedAt: new Date("2026-11-10T09:00:00Z") }) });
    expect(html).toContain("Reviewed");
    expect(html).not.toContain("Reviewed by");
  });

  it("renders nothing for an unreviewed receipt with no checks", () => {
    expect(render({ receipt: receipt(), checks: [] })).toBe("");
  });
});

describe("reviewFailure", () => {
  it("doesn't offer a retry that can't work", () => {
    expect(reviewFailure(404)).toMatch(/deleted, or you can no longer change it/);
    expect(reviewFailure(null)).toBe("Check your connection and try again.");
    expect(reviewFailure(500)).toBe("Try again.");
  });
});
