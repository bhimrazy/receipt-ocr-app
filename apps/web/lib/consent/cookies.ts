/**
 * Every cookie and browser storage key the app sets or causes to be set. The /cookies page is
 * rendered from this list, and cookies.test.ts fails when the code sets a name missing here.
 * Better Auth uses its default "better-auth" prefix; over HTTPS it adds "__Secure-" in front.
 * Not listed because this config never sets them: session_data and account_data (cookie cache
 * off) and dont_remember (sign-in never passes rememberMe: false).
 */

export type StorageCategory = "necessary" | "analytics" | "marketing";

export type StorageEntry = {
  /** Exact name; a trailing `*` matches any suffix. */
  name: string;
  kind: "cookie" | "localStorage" | "cache";
  setBy: "receiptOCR" | "Cloudflare" | "Google";
  category: StorageCategory;
  purpose: string;
  duration: string;
  /** Listed only when this optional feature is on in the build. */
  feature?: "turnstile" | "googleAnalytics";
  /** Shown under the name, e.g. the HTTPS prefix. */
  note?: string;
};

const secureNote = "Named __Secure-… on HTTPS.";

export const storageEntries: StorageEntry[] = [
  {
    name: "better-auth.session_token",
    kind: "cookie",
    setBy: "receiptOCR",
    category: "necessary",
    purpose: "Keeps you signed in. Not readable by page scripts.",
    duration: "7 days, renewed daily while you use the app",
    note: secureNote,
  },
  {
    name: "better-auth.state",
    kind: "cookie",
    setBy: "receiptOCR",
    category: "necessary",
    purpose:
      "Protects Google and GitHub sign-in from forged requests by checking that the reply matches the request you started.",
    duration: "5 minutes",
    note: secureNote,
  },
  {
    name: "better-auth.admin_session",
    kind: "cookie",
    setBy: "receiptOCR",
    category: "necessary",
    purpose:
      "Only for receiptOCR administrators handling a support request: holds the administrator's own session while they view an account.",
    duration: "Until the administrator stops, at most 7 days",
    note: secureNote,
  },
  {
    name: "signed_in_hint",
    kind: "cookie",
    setBy: "receiptOCR",
    category: "necessary",
    purpose:
      'Lets the home page show "Open the app" instead of "Sign in". It holds only the value 1, never who you are.',
    duration: "30 days",
  },
  {
    name: "consent",
    kind: "cookie",
    setBy: "receiptOCR",
    category: "necessary",
    purpose: "Remembers your cookie settings, the policy version you answered and when.",
    duration: "6 months",
  },
  {
    name: "cf_clearance, cf_chl_*",
    kind: "cookie",
    setBy: "Cloudflare",
    category: "necessary",
    purpose:
      "Cloudflare Turnstile, the bot check on sign-up, sign-in, password reset and the contact form. Set inside Cloudflare's check frame on challenges.cloudflare.com, not on our domain.",
    duration: "Set by Cloudflare",
    feature: "turnstile",
  },
  {
    name: "receiptocr.install-dismissed",
    kind: "localStorage",
    setBy: "receiptOCR",
    category: "necessary",
    purpose: "Remembers that you closed the install-the-app prompt, so it doesn't show again.",
    duration: "Until you clear site data",
  },
  {
    name: "receiptocr-static-v*",
    kind: "cache",
    setBy: "receiptOCR",
    category: "necessary",
    purpose: "The installed app's offline page and icons. Never your receipts or account data.",
    duration: "Replaced with each new version of the app",
  },
  {
    name: "receiptocr-shared",
    kind: "cache",
    setBy: "receiptOCR",
    category: "necessary",
    purpose:
      "Holds files you share to the installed app from another Android app until the upload screen picks them up.",
    duration: "Removed once picked up",
  },
  {
    name: "_ga",
    kind: "cookie",
    setBy: "Google",
    category: "analytics",
    purpose:
      "Google Analytics: a random id that tells repeat visits apart. Set only after you accept analytics cookies.",
    duration: "2 years",
    feature: "googleAnalytics",
  },
  {
    name: "_ga_*",
    kind: "cookie",
    setBy: "Google",
    category: "analytics",
    purpose: "Google Analytics: keeps the state of your current visit.",
    duration: "2 years",
    feature: "googleAnalytics",
  },
];

export function entriesFor(features: { turnstile: boolean; googleAnalytics: boolean }) {
  return storageEntries.filter((entry) => !entry.feature || features[entry.feature]);
}

/** Matches a name found in code (where `*` stands for a runtime part) against an entry. */
export function entryCovers(entry: StorageEntry, name: string): boolean {
  return entry.name.split(", ").some((pattern) => {
    if (pattern === name) return true;
    if (!pattern.endsWith("*")) return false;
    const prefix = pattern.slice(0, -1);
    return name.startsWith(prefix);
  });
}
