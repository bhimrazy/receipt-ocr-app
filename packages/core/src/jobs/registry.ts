import { receiptExtract } from "./kinds/receipt-extract";

/** Every job kind the app runs, by kind. Workers and drains run these. */
export const JOB_REGISTRY = {
  [receiptExtract.kind]: receiptExtract,
};
