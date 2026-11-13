import { Layer } from "effect";
import { Billing } from "./billing/service";
import { ContactReplyMailer } from "./jobs/kinds/contact-reply";
import { SupportNotifyMailer } from "./jobs/kinds/support-notify";
import { WelcomeMailer } from "./jobs/kinds/welcome-email";
import { JobQueue } from "./jobs/queue";
import { ReceiptRepo } from "./repository";
import { Ocr } from "./ocr";
import { Db, Storage } from "./services";
import { Settings } from "./settings";
import { WideEventLoggerLive } from "./telemetry/logger";

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";
export * from "./account-security";
export * from "./analytics/index";
export * from "./billing/index";
export * from "./config";
export * from "./connections";
export * from "./errors";
export * from "./files";
export * from "./groups";
export * from "./health";
export * from "./jobs";
export * from "./newsletter";
export * from "./ocr";
export * from "./pipeline";
export * from "./quota";
export * from "./receipt-fields";
export * from "./receipt-patch";
export * from "./repository";
export * from "./review-reasons";
export * from "./services";
export * from "./settings";
export * from "./support";
export * from "./step-up/index";
export * from "./telemetry";
export * from "./usage";
export * from "./plans";
export * from "./workspace";
export * from "./workspace-name";

/** Everything the web app (and a future worker) needs; build it once into a ManagedRuntime. */
export const makeAppLayer = (
  mailers: Layer.Layer<WelcomeMailer | ContactReplyMailer | SupportNotifyMailer>,
) =>
  Layer.mergeAll(
    ReceiptRepo.Live,
    Storage.Live,
    Ocr.Live,
    JobQueue.Live,
    Billing.Live,
    WideEventLoggerLive,
    mailers,
  ).pipe(Layer.provideMerge(Settings.Live), Layer.provideMerge(Db.Live));

/** For tests only: mailers that send nothing; the web app passes the real ones to `makeAppLayer`. */
export const AppLayer = makeAppLayer(
  Layer.mergeAll(WelcomeMailer.Disabled, ContactReplyMailer.Disabled, SupportNotifyMailer.Disabled),
);

export type AppServices = Layer.Layer.Success<typeof AppLayer>;
export * from "./admin";
export * from "./audit";
export * from "./admin-queries";
export * from "./admin-ops";
