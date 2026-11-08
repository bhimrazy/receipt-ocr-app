import { Layer } from "effect";
import { WelcomeMailer } from "./jobs/kinds/welcome-email";
import { JobQueue } from "./jobs/queue";
import { ReceiptRepo } from "./repository";
import { Ocr } from "./ocr";
import { Db, Storage } from "./services";
import { Settings } from "./settings";
import { WideEventLoggerLive } from "./telemetry/logger";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";
export * from "./analytics/index";
export * from "./config";
export * from "./connections";
export * from "./errors";
export * from "./files";
export * from "./groups";
export * from "./health";
export * from "./jobs";
export * from "./ocr";
export * from "./pipeline";
export * from "./quota";
export * from "./repository";
export * from "./services";
export * from "./settings";
export * from "./step-up/index";
export * from "./telemetry";
export * from "./usage";
export * from "./plans";
export * from "./workspace";
export * from "./workspace-name";

/** Everything the web app (and a future worker) needs; build it once into a ManagedRuntime. */
export const makeAppLayer = (mailer: Layer.Layer<WelcomeMailer>) =>
  Layer.mergeAll(
    ReceiptRepo.Live,
    Storage.Live,
    Ocr.Live,
    JobQueue.Live,
    WideEventLoggerLive,
    mailer,
  ).pipe(Layer.provideMerge(Settings.Live), Layer.provideMerge(Db.Live));

/** With a welcome mailer that sends nothing; the web app passes the real one to `makeAppLayer`. */
export const AppLayer = makeAppLayer(WelcomeMailer.Disabled);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
export * from "./admin";
export * from "./audit";
export * from "./admin-queries";
export * from "./admin-ops";
