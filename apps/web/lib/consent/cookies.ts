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
  kind: "cookie" | "localStorage" | "sessionStorage" | "cache";
  setBy: "ReceiptOCR" | "Cloudflare" | "Google";
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
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose: "Keeps you signed in. Not readable by page scripts.",
    duration: "7 days, renewed daily while you use the app",
    note: secureNote,
  },
  {
    name: "better-auth.state",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Protects Google and GitHub sign-in from forged requests by checking that the reply matches the request you started.",
    duration: "5 minutes",
    note: secureNote,
  },
  {
    name: "better-auth.two_factor",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Only if you use two-step sign-in: links the code step to the password you just entered. Signed, and holds no password or code.",
    duration: "10 minutes, or until you enter the code",
    note: secureNote,
  },
  {
    name: "better-auth.better-auth-passkey",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "While you sign in with or add a passkey: ties your device's answer to the challenge we sent. Signed, holds no key.",
    duration: "5 minutes",
    note: secureNote,
  },
  {
    name: "better-auth.trust_device",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      'Only if you tick "Trust this device" at the code step: lets this browser skip the code. Turning two-step sign-in off, or an administrator reset, cancels it on every device.',
    duration: "30 days, renewed each time you sign in with it",
    note: secureNote,
  },
  {
    name: "better-auth.admin_session",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Only for ReceiptOCR administrators handling a support request: holds the administrator's own session while they view an account.",
    duration: "Until the administrator stops, at most 7 days",
    note: secureNote,
  },
  {
    name: "signed_in_hint",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      'Lets the home page show "Open the app" instead of "Sign in". It holds only the value 1, never who you are.',
    duration: "30 days",
  },
  {
    name: "receiptocr_security_prompt",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Remembers that you closed the one-time reminder to add a passkey or authenticator app. It holds your account id.",
    duration: "400 days",
  },
  {
    name: "tz",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      'Remembers your browser\'s time zone so the signed-in app shows your data correctly, such as the right "today". It holds only the zone name and is sent nowhere but this app.',
    duration:
      "Up to 30 days; rewritten when your zone changes. Safari keeps cookies set by page scripts for 7 days at most.",
  },
  {
    name: "consent",
    kind: "cookie",
    setBy: "ReceiptOCR",
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
    name: "receiptocr.install",
    kind: "localStorage",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Remembers when you closed an offer to install the app, how often the home page showed it, and whether you installed it, so it isn't shown again too soon.",
    duration: "Until you clear site data",
  },
  {
    name: "has_account",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Remembers that someone has signed in on this browser, so opening the installed app signed out shows sign-in rather than sign-up. It holds only the value 1. Not readable by page scripts.",
    duration: "1 year",
  },
  {
    name: "display_mode",
    kind: "cookie",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Set only while you use the installed app: tells us a sign-up came from the app rather than a browser tab. It holds only the word standalone.",
    duration: "30 minutes",
  },
  {
    name: "theme",
    kind: "localStorage",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Remembers the theme you chose (Light or Dark) on this device. Not set while you use System, which follows your device.",
    duration: "Until you clear site data or choose System",
  },
  {
    name: "receiptocr:security-nudge-dismissed",
    kind: "localStorage",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose:
      "Remembers when you closed the two-step sign-in reminder, so it stays away for 30 days.",
    duration: "Until you clear site data",
  },
  {
    name: "receipt-ocr.capture.filter",
    kind: "sessionStorage",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose: "Remembers the photo filter you last chose when reviewing a photo before upload.",
    duration: "Until you close the tab",
  },
  {
    name: "receiptocr-static-v*",
    kind: "cache",
    setBy: "ReceiptOCR",
    category: "necessary",
    purpose: "The installed app's offline page and icons. Never your receipts or account data.",
    duration: "Replaced with each new version of the app",
  },
  {
    name: "receiptocr-shared",
    kind: "cache",
    setBy: "ReceiptOCR",
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
