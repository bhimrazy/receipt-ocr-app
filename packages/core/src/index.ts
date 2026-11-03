import { Layer } from "effect";
import { ReceiptRepo } from "./repository";
import { Db, Ocr, Storage } from "./services";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";
export * from "./config";
export * from "./errors";
export * from "./files";
export * from "./pipeline";
export * from "./quota";
export * from "./repository";
export * from "./services";
export * from "./workspace";

/** Everything the web app (and a future worker) needs; build it once into a ManagedRuntime. */
export const AppLayer = Layer.mergeAll(ReceiptRepo.Live, Storage.Live, Ocr.Live).pipe(
  Layer.provideMerge(Db.Live),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
