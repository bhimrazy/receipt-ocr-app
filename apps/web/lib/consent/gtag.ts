import { isAnalyticsPath, stripUrl } from "./config";

type Gtag = (...args: unknown[]) => void;
type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: Gtag } & Record<string, unknown>;

const w = () => window as unknown as GtagWindow;

/**
 * Consent Mode v2, basic mode: gtag.js loads only after the visitor accepts, and every signal
 * starts denied before any config. Only analytics_storage is ever granted; the three ads
 * signals stay denied because nothing here is marketing.
 */
let initialised = false;

export function initGtag(id: string) {
  if (initialised) return;
  initialised = true;
  const win = w();
  win.dataLayer = win.dataLayer ?? [];
  if (!win.gtag) {
    win.gtag = function gtag() {
      // gtag.js reads Arguments objects from the queue, not arrays.
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments);
    };
  }
  const gtag = win.gtag;
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("js", new Date());
  // Page views are sent by gtagPageView with a stripped URL, never by gtag itself.
  // page_location and page_referrer are set here and again on every page view: gtag's automatic
  // hits (user_engagement, scroll, form and outbound-click events) default to location.href,
  // which on /sign-in can carry ?redirect=/app/receipts/<id>.
  gtag("config", id, {
    page_location: location.origin + location.pathname,
    page_referrer: safeReferrer(document.referrer),
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

/** Origin + path only; a same-site referrer from a page outside the allowlist becomes the origin. */
function safeReferrer(referrer: string): string {
  const stripped = stripUrl(referrer);
  if (!stripped) return "";
  const url = new URL(stripped);
  if (url.origin === location.origin && !isAnalyticsPath(url.pathname)) return url.origin;
  return stripped;
}

export function gtagPageView(pathname: string) {
  const gtag = w().gtag;
  if (!gtag) return;
  const page = {
    page_location: `${location.origin}${pathname}`,
    page_referrer: safeReferrer(document.referrer),
  };
  // "set" first, so every later automatic hit inherits the stripped values.
  gtag("set", page);
  gtag("event", "page_view", { ...page, page_title: document.title });
}

/**
 * gtag.js can't be unloaded once it runs, so this flag (checked by gtag on every hit) stops it
 * on pages outside the allowlist and after consent is withdrawn.
 */
export function setGtagDisabled(id: string, disabled: boolean) {
  w()[`ga-disable-${id}`] = disabled;
}

/** After a withdrawal and a new accept in the same page. */
export function grantGtag() {
  w().gtag?.("consent", "update", { analytics_storage: "granted" });
}

export function withdrawGtag(id: string) {
  setGtagDisabled(id, true);
  w().gtag?.("consent", "update", { analytics_storage: "denied" });
  deleteGaCookies();
}

/** Works whether or not gtag ever loaded on this page: a withdrawal on a 404 still clears _ga*. */
export function deleteGaCookies() {
  // GA writes its cookies on the widest domain it can, so try the host and every parent.
  const names = document.cookie
    .split("; ")
    .map((part) => part.split("=")[0]!)
    .filter((name) => name === "_ga" || name.startsWith("_ga_"));
  const labels = location.hostname.split(".");
  const domains = [""];
  for (let i = 0; i < labels.length - 1; i++)
    domains.push(`; Domain=.${labels.slice(i).join(".")}`);
  for (const name of names) {
    for (const domain of domains) document.cookie = `${name}=; Path=/; Max-Age=0${domain}`;
  }
}
