import { scheduleFlush, type EventRecord } from "@receipt-ocr/core/telemetry";

/**
 * Product analytics events: a closed set, keyed by an opaque user id, with
 * props from our own vocabulary only. No emails, names, receipt contents,
 * amounts, merchants, file names or URLs. Most events are projections of
 * wide events that already passed the allowlist (`fromRecord`); the rest go
 * through `track()`. Both meet the same runtime check, so a cast can't
 * smuggle a field in.
 */

type Kind = "token" | "int" | "bool";

const EVENTS = {
  signed_up: { method: "token", standalone: "bool" },
  receipt_uploaded: { mode: "token", plan: "token", size_choice: "token" },
  receipt_scanned: { trigger: "token", model: "token", fallback: "bool", calls: "int" },
  receipt_scan_failed: { trigger: "token", error_kind: "token" },
  csv_exported: { count: "int" },
  plan_limit_hit: { limit: "token", plan: "token" },
  plan_changed: { from: "token", to: "token" },
  install_offer: { action: "token", surface: "token", platform: "token" },
} as const satisfies Record<string, Record<string, Kind>>;

export type ProductEventName = keyof typeof EVENTS;

export type ProductEvent = {
  name: ProductEventName;
  userId: string;
  workspaceId?: string;
  props?: Record<string, string | number | boolean | undefined>;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[a-z0-9][a-z0-9_.:/-]{0,63}$/i;

const valid = (kind: Kind, value: unknown) =>
  kind === "token"
    ? typeof value === "string" && TOKEN.test(value)
    : kind === "int"
      ? Number.isInteger(value)
      : typeof value === "boolean";

/** The event as it may be sent, or null when its name or ids don't pass. Unknown props are dropped. */
export function checkEvent(event: ProductEvent): ProductEvent | null {
  const spec = EVENTS[event.name] as Record<string, Kind> | undefined;
  if (!spec || !Object.hasOwn(EVENTS, event.name) || !ID.test(event.userId)) return null;
  if (event.workspaceId !== undefined && !ID.test(event.workspaceId)) return null;
  const props: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(event.props ?? {})) {
    const kind = Object.hasOwn(spec, key) ? spec[key] : undefined;
    if (kind && valid(kind, value)) props[key] = value as string | number | boolean;
  }
  // Also a plain prop: PostHog's `groups` needs the paid group-analytics add-on.
  if (event.workspaceId) props.workspace_id = event.workspaceId;
  return {
    name: event.name,
    userId: event.userId,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    props,
  };
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const group = (value: unknown) =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The product event a finished unit of work stands for, if any. Requests an
 * admin made while impersonating never count.
 */
export function fromRecord(record: EventRecord): ProductEvent | null {
  if (record.impersonated_by) return null;
  const userId = str(record.user_id);
  if (!userId) return null;
  const workspaceId = str(record.organization_id);
  const status = typeof record.status_code === "number" ? record.status_code : undefined;
  const ok = status !== undefined && status >= 200 && status < 300;

  if (record.unit === "request") {
    if (record.event === "receipt.upload" && ok) {
      return {
        name: "receipt_uploaded",
        userId,
        workspaceId,
        props: {
          mode: str(record.mode),
          plan: str(record.plan),
          size_choice: str(record.size_choice),
        },
      };
    }
    if (record.event === "receipt.export" && ok) {
      return {
        name: "csv_exported",
        userId,
        workspaceId,
        props: { count: record.count as number | undefined },
      };
    }
    // A plan limit (the day, the month, the Free pool or the per-minute burst), not the service-wide cap,
    // and not a repeat within the minute (`keepQuotaRejection` in http.ts).
    const limit = str(group(record.error).kind);
    if (
      status === 429 &&
      record.outcome === "QuotaExceeded" &&
      (limit === "day" || limit === "month" || limit === "pool" || limit === "minute") &&
      group(record.flags).quota_repeat !== true
    ) {
      return {
        name: "plan_limit_hit",
        userId,
        workspaceId,
        props: { limit, plan: str(record.plan) },
      };
    }
    return null;
  }

  // A billing event that moved a workspace between plans, attributed to the buyer.
  if (record.unit === "job_attempt" && group(record.queue).kind === "billing.apply_event") {
    const billing = group(record.billing);
    const from = str(billing.plan_from);
    const to = str(billing.plan_to);
    if (group(record.queue).outcome !== "succeeded" || !from || !to) return null;
    return { name: "plan_changed", userId, workspaceId, props: { from, to } };
  }

  // An admin re-running a user's job isn't the user scanning.
  if (record.unit === "job_attempt" && record.trigger !== "admin_rerun") {
    const queue = group(record.queue);
    const ocr = group(record.ocr);
    const trigger = str(record.trigger);
    if (queue.outcome === "succeeded" && ocr.model !== undefined) {
      return {
        name: "receipt_scanned",
        userId,
        workspaceId,
        props: {
          trigger,
          model: str(ocr.model),
          fallback: typeof ocr.fallback === "boolean" ? ocr.fallback : undefined,
          calls: typeof ocr.calls === "number" ? ocr.calls : undefined,
        },
      };
    }
    if (queue.outcome === "dead") {
      return {
        name: "receipt_scan_failed",
        userId,
        workspaceId,
        props: { trigger, error_kind: str(queue.error_kind) },
      };
    }
  }
  return null;
}

type Sender = (event: ProductEvent) => void;

// On globalThis: instrumentation starts PostHog, the app's bundle calls track().
const slot = globalThis as { __receiptOcrProductEvents?: Sender };

export function setProductEventSender(sender: Sender | undefined): void {
  slot.__receiptOcrProductEvents = sender;
}

/** Sends a product event when PostHog is configured; otherwise does nothing. Never throws. */
export function track(event: ProductEvent): void {
  const send = slot.__receiptOcrProductEvents;
  if (!send) return;
  try {
    const checked = checkEvent(event);
    if (!checked) return;
    send(checked);
    // Outside a request's wide event nothing else would schedule the send.
    scheduleFlush();
  } catch {
    // Analytics never fails the work it describes.
  }
}

/** Better Auth's endpoint path for the sign-up: `/sign-up/email` or `/callback/<provider>`. */
export function signUpMethod(path: string | undefined, provider: string | undefined): string {
  if (path?.startsWith("/sign-up/email")) return "email";
  if (provider === "google" || provider === "github") return provider;
  return "other";
}
