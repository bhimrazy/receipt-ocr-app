import { CONSENT_MAX_AGE_SECONDS, CONSENT_VERSION } from "./config";

/** The visitor's saved choice. `marketing` is always false until a marketing tool exists. */
export type ConsentRecord = {
  version: number;
  /** Seconds since the epoch. */
  savedAt: number;
  /** Google Analytics cookies: opt-in. */
  analytics: boolean;
  marketing: boolean;
  /** Cookie-free page counts (Vercel Web Analytics): on unless the visitor objects. */
  pageCounts: boolean;
};

export type ConsentChoice = Pick<ConsentRecord, "analytics" | "marketing" | "pageCounts">;

/** Which optional tools this build runs. */
export type ConsentFeatures = { googleAnalytics: boolean; pageCounts: boolean };

export type PrivacySignals = {
  /** Global Privacy Control: a do-not-sell-or-share request (CCPA/CPRA and other US states). */
  gpc: boolean;
  /** Do Not Track: no legal force, but a plain request not to be measured. */
  dnt: boolean;
};

export function serializeConsent(record: ConsentRecord): string {
  return new URLSearchParams({
    v: String(record.version),
    ts: String(record.savedAt),
    analytics: record.analytics ? "1" : "0",
    marketing: record.marketing ? "1" : "0",
    pagecounts: record.pageCounts ? "1" : "0",
  }).toString();
}

const flag = (value: string | null) => (value === "1" ? true : value === "0" ? false : null);

/**
 * Null when there is no usable choice: missing, malformed, saved under another policy version,
 * dated in the future, or older than the 12-month lifetime. Null means "ask again".
 */
export function parseConsent(raw: string | undefined, nowSeconds: number): ConsentRecord | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const version = Number(params.get("v"));
  const savedAt = Number(params.get("ts"));
  const analytics = flag(params.get("analytics"));
  const marketing = flag(params.get("marketing"));
  const pageCounts = flag(params.get("pagecounts"));
  if (version !== CONSENT_VERSION) return null;
  if (!Number.isInteger(savedAt) || savedAt <= 0) return null;
  // A day of slack for clock skew between the server that set it and this device.
  if (savedAt > nowSeconds + 86_400 || nowSeconds - savedAt > CONSENT_MAX_AGE_SECONDS) return null;
  if (analytics === null || marketing === null || pageCounts === null) return null;
  return { version, savedAt, analytics, marketing, pageCounts };
}

export function makeRecord(choice: ConsentChoice, nowSeconds: number): ConsentRecord {
  return { version: CONSENT_VERSION, savedAt: Math.floor(nowSeconds), ...choice };
}

export const ACCEPT_ALL: ConsentChoice = { analytics: true, marketing: false, pageCounts: true };
export const REJECT_ALL: ConsentChoice = { analytics: false, marketing: false, pageCounts: false };

export function readSignals(nav: {
  globalPrivacyControl?: unknown;
  doNotTrack?: unknown;
}): PrivacySignals {
  return { gpc: nav.globalPrivacyControl === true, dnt: nav.doNotTrack === "1" };
}

/**
 * What may run right now. GA shares data with Google, so GPC turns it off; DNT turns off all
 * measurement, including cookie-free page counts. Neither can be overridden from the dialog.
 */
export function allowedTools(
  record: ConsentRecord | null,
  signals: PrivacySignals,
  features: ConsentFeatures,
): { googleAnalytics: boolean; pageCounts: boolean } {
  return {
    googleAnalytics:
      features.googleAnalytics && !signals.gpc && !signals.dnt && record?.analytics === true,
    pageCounts: features.pageCounts && !signals.dnt && (record?.pageCounts ?? true),
  };
}

/**
 * The banner asks only when a tool that needs consent is configured, the visitor hasn't
 * answered, and the browser hasn't already answered for them.
 */
export function needsBanner(
  record: ConsentRecord | null,
  signals: PrivacySignals,
  features: ConsentFeatures,
): boolean {
  return features.googleAnalytics && record === null && !signals.gpc && !signals.dnt;
}
