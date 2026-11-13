import { describe, expect, it } from "vitest";
import { parsePaymentLink } from "@/lib/payment-link";

const id = "txn_01h2b0qpjc0xt8k5aw6nsdec4p";

describe("parsePaymentLink", () => {
  it("reads one well-formed transaction id", () => {
    expect(parsePaymentLink(id)).toEqual({ kind: "transaction", transactionId: id });
  });

  it("is none without the parameter", () => {
    expect(parsePaymentLink(undefined)).toEqual({ kind: "none" });
  });

  it.each([
    ["empty", ""],
    ["another Paddle id", "sub_01h2b0qpjc0xt8k5aw6nsdec4p"],
    ["upper case", "txn_01H2B0QPJC0XT8K5AW6NSDEC4P"],
    ["too short", "txn_01h2b0qpjc"],
    ["trailing text", `${id}x`],
    ["markup", `${id}"><script>`],
    ["a newline", `${id}\n`],
    ["repeated", [id, id]],
  ])("refuses %s", (_what, value) => {
    expect(parsePaymentLink(value)).toEqual({ kind: "invalid" });
  });
});
