import type { JobRegistry } from "./definition";
import { receiptExtract } from "./kinds/receipt-extract";
import { welcomeEmail } from "./kinds/welcome-email";

type Requirements<D> = D extends { run: (...args: never[]) => infer E }
  ? E extends import("effect").Effect.Effect<unknown, unknown, infer R>
    ? R
    : never
  : never;

/** Every job kind the app runs, by kind. Workers and drains run these. */
export const JOB_REGISTRY: JobRegistry<Requirements<typeof receiptExtract | typeof welcomeEmail>> =
  {
    [receiptExtract.kind]: receiptExtract,
    [welcomeEmail.kind]: welcomeEmail,
  };
