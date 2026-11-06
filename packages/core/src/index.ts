import { Layer } from "effect";
import { ReceiptRepo } from "./repository";
import { Ocr } from "./ocr";
import { Db, Storage } from "./services";
import { Settings } from "./settings";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";
export * from "./config";
export * from "./errors";
export * from "./files";
export * from "./health";
export * from "./ocr";
export * from "./pipeline";
export * from "./quota";
export * from "./repository";
export * from "./services";
export * from "./settings";
export * from "./usage";
export * from "./plans";
export * from "./workspace";
export * from "./workspace-name";

/** Everything the web app (and a future worker) needs; build it once into a ManagedRuntime. */
export const AppLayer = Layer.mergeAll(ReceiptRepo.Live, Storage.Live, Ocr.Live).pipe(
  Layer.provideMerge(Settings.Live),
  Layer.provideMerge(Db.Live),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
export * from "./admin";
export * from "./audit";
export * from "./admin-queries";
