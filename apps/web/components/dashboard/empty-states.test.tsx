import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoReadReceipts, NothingInRange } from "./empty-states";

describe("NoReadReceipts", () => {
  it("says receipts are being scanned, with the right plural", () => {
    const one = renderToStaticMarkup(<NoReadReceipts failed={0} inFlight={1} />);
    expect(one).toContain("1 receipt is");
    expect(renderToStaticMarkup(<NoReadReceipts failed={0} inFlight={3} />)).toContain(
      "3 receipts are",
    );
  });

  it("links failed receipts to Receipts", () => {
    const html = renderToStaticMarkup(<NoReadReceipts failed={2} inFlight={0} />);
    expect(html).toContain("2 receipts couldn&#x27;t be scanned");
    expect(html).toContain('href="/app/receipts?status=failed"');
  });
});

describe("NothingInRange", () => {
  it("offers a wider range only when one is given", () => {
    const props = { what: "EUR receipts", span: "in the last 30 days" };
    expect(renderToStaticMarkup(<NothingInRange {...props} />)).not.toContain("Show the last");
    expect(
      renderToStaticMarkup(<NothingInRange {...props} widerHref="/app/spending?range=12m" />),
    ).toContain('href="/app/spending?range=12m"');
  });
});
