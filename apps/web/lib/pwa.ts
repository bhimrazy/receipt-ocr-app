/** The signed-in app, where the service worker registers. */
export function isAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** iPadOS Safari reports a Mac user agent, so touch support tells it apart from a Mac. */
export function isIpad(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Which browser on iPhone or iPad, or null when not iOS. Only Safari can add the app to the Home
 * Screen reliably; Chrome and the rest (Firefox, Edge, in-app browsers with no "Safari/" token)
 * are told to open the page in Safari.
 */
export function iosBrowser(
  userAgent: string,
  maxTouchPoints: number,
): "safari" | "chrome" | "other" | null {
  if (!isIos(userAgent, maxTouchPoints)) return null;
  if (/CriOS/.test(userAgent)) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV/.test(userAgent)) return "other";
  return /Safari\//.test(userAgent) ? "safari" : "other";
}

/**
 * What we remember about install offers, in one localStorage key.
 * - `app`: the card after a read receipt. The first "Not now" hides it 30 days, the second for good.
 * - `landing`: the timed sheet on the home page. "Not now" hides it 7 days; it shows 3 times at most.
 * - `lastDismissedAt`: any dismissal, including declining Chrome's own prompt from any surface,
 *   hides every offer for 7 days.
 * - `installed`: set on `appinstalled`; nothing offers to install again, menu rows included.
 */
export type InstallState = {
  app?: { dismissals: number; until: string | null };
  landing?: { shows: number; until: string | null };
  lastDismissedAt?: string;
  installed?: boolean;
};

export type OfferPlacement = "app" | "landing";

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_SNOOZE_DAYS = 30;
const LANDING_SNOOZE_DAYS = 7;
const LANDING_MAX_SHOWS = 3;
const SHARED_COOLDOWN_DAYS = 7;

const later = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS).toISOString();
const before = (now: Date, iso: string) => {
  const at = Date.parse(iso);
  return Number.isNaN(at) || now.getTime() < at;
};

/** Whether the dismissible offer at `placement` may show now. Menu rows don't ask. */
export function canOffer(state: InstallState, placement: OfferPlacement, now: Date): boolean {
  if (state.installed) return false;
  if (
    state.lastDismissedAt &&
    before(now, later(new Date(state.lastDismissedAt), SHARED_COOLDOWN_DAYS))
  )
    return false;
  if (placement === "app") {
    const app = state.app;
    if (!app || app.dismissals < 1) return true;
    return app.until !== null && !before(now, app.until);
  }
  const landing = state.landing;
  if (!landing) return true;
  if (landing.shows >= LANDING_MAX_SHOWS) return false;
  return landing.until === null || !before(now, landing.until);
}

/** The state after the offer at `placement` was shown once (counts toward the landing cap). */
export function shown(state: InstallState, placement: OfferPlacement): InstallState {
  if (placement !== "landing") return state;
  const landing = state.landing ?? { shows: 0, until: null };
  return { ...state, landing: { ...landing, shows: landing.shows + 1 } };
}

/**
 * The state after a dismissal: "Not now" at `placement`, or declining Chrome's prompt opened
 * from it. With no placement (a menu row), only the shared cooldown starts.
 */
export function dismissed(
  state: InstallState,
  placement: OfferPlacement | null,
  now: Date,
): InstallState {
  const next: InstallState = { ...state, lastDismissedAt: now.toISOString() };
  if (placement === "app") {
    const dismissals = (state.app?.dismissals ?? 0) + 1;
    next.app = { dismissals, until: dismissals === 1 ? later(now, APP_SNOOZE_DAYS) : null };
  } else if (placement === "landing") {
    next.landing = {
      shows: state.landing?.shows ?? 0,
      until: later(now, LANDING_SNOOZE_DAYS),
    };
  }
  return next;
}

export function markInstalled(state: InstallState): InstallState {
  return { ...state, installed: true };
}

const isDate = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Reads stored state; anything malformed is dropped field by field. */
export function parseInstallState(raw: string | null): InstallState {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null) return {};
  const input = value as Record<string, unknown>;
  const state: InstallState = {};
  const app = input.app as Record<string, unknown> | undefined;
  if (app && isCount(app.dismissals) && isDate(app.until))
    state.app = { dismissals: app.dismissals, until: app.until };
  const landing = input.landing as Record<string, unknown> | undefined;
  if (landing && isCount(landing.shows) && isDate(landing.until))
    state.landing = { shows: landing.shows, until: landing.until };
  if (typeof input.lastDismissedAt === "string" && isDate(input.lastDismissedAt))
    state.lastDismissedAt = input.lastDismissedAt;
  if (input.installed === true) state.installed = true;
  return state;
}

const INSTALL_KEY = "receiptocr.install";
/** The one-flag predecessor: "1" meant one permanent dismissal of the app card. */
const LEGACY_KEY = "receiptocr.install-dismissed";

/** The old flag becomes one app dismissal, so the card returns once, after 30 days. */
export function migrateLegacy(legacy: string | null, now: Date): InstallState {
  return legacy === "1" ? { app: { dismissals: 1, until: later(now, APP_SNOOZE_DAYS) } } : {};
}

// Storage can throw (Safari private mode, blocked site data); then offers just show again.
export function loadInstallState(): InstallState {
  try {
    const raw = localStorage.getItem(INSTALL_KEY);
    if (raw !== null) return parseInstallState(raw);
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === null) return {};
    const state = migrateLegacy(legacy, new Date());
    localStorage.setItem(INSTALL_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_KEY);
    return state;
  } catch {
    return {};
  }
}

export function saveInstallState(state: InstallState): void {
  try {
    localStorage.setItem(INSTALL_KEY, JSON.stringify(state));
  } catch {
    // Not remembered; see above.
  }
}
