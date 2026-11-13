import type { ReceiptWithItems } from "@receipt-ocr/core";
import { totalsMismatch } from "@receipt-ocr/core/review-reasons";
import { formatConfidence } from "@/lib/format";

type CheckedReceipt = Pick<
  ReceiptWithItems,
  | "confidence"
  | "currency"
  | "discount"
  | "imageObjectKey"
  | "items"
  | "merchant"
  | "receiptDate"
  | "reviewReasons"
  | "serviceCharge"
  | "subtotal"
  | "tax"
  | "tip"
  | "total"
>;

/** "photo" or "PDF", so failure and review copy names what the person actually uploaded. */
export function fileNoun(receipt: { imageObjectKey: string | null }) {
  return receipt.imageObjectKey?.endsWith(".pdf") ? "PDF" : "photo";
}

/**
 * The receipt's stored review reasons in plain words, one line each: the same list that puts it in Needs review.
 * A reason this version doesn't know gets a generic line rather than none.
 */
export function checksFor(receipt: CheckedReceipt, money: (value: string | null) => string | null) {
  const noun = fileNoun(receipt);
  const lines = receipt.reviewReasons.map((reason) => {
    switch (reason) {
      case "no_merchant":
        return "No merchant name was found.";
      case "no_date":
        return "No date was found.";
      case "no_total":
        return "No total was found.";
      case "no_currency":
        return `No currency was found. Amounts show as USD until you set it.`;
      case "totals_mismatch": {
        const expected = totalsMismatch(receipt);
        return expected === null
          ? `The amounts don't add up to the total. Check them against the ${noun}.`
          : `The amounts add up to ${money(expected.toFixed(2))}, but the total says ${money(receipt.total)}. Rounding can explain a small gap; otherwise check the numbers against the ${noun}.`;
      }
      case "date_ambiguous":
        return `The date could be read more than one way, or is a long time ago. Check it against the ${noun}.`;
      case "date_conflict":
        return `The dates printed on the receipt don't agree. Check the date against the ${noun}.`;
      case "date_implausible":
        return `The printed date isn't a possible date for this receipt, so none was saved. Check the ${noun}.`;
      case "low_confidence":
        return `Overall confidence is ${formatConfidence(receipt.confidence) ?? "low"}. Compare the merchant, date and total with the ${noun}.`;
      default:
        return `Something on this receipt needs a check. Compare it with the ${noun}.`;
    }
  });
  return [...new Set(lines)];
}
