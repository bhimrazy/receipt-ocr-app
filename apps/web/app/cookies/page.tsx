import type { Metadata } from "next";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { LegalPage } from "@/components/legal-page";
import { entriesFor, type StorageCategory, type StorageEntry } from "@/lib/consent/cookies";
import { gaMeasurementId, turnstileOn } from "@/lib/consent/env";
import { LEGAL_UPDATED, formatLegalDate, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Cookie policy",
  description:
    "Every cookie and storage key ReceiptOCR uses, what it is for, how long it lasts, and how to change your choice.",
  path: "/cookies",
});

const googleAnalytics = Boolean(gaMeasurementId);
const pageCounts = process.env.VERCEL === "1";

const categoryTitle: Record<StorageCategory, string> = {
  necessary: "Necessary",
  analytics: "Analytics (only if you accept)",
  marketing: "Marketing",
};

const kindLabel: Record<StorageEntry["kind"], string> = {
  cookie: "Cookie",
  localStorage: "Local storage",
  sessionStorage: "Session storage",
  cache: "Cache storage",
};

export default function CookiesPage() {
  const entries = entriesFor({ turnstile: turnstileOn, googleAnalytics });
  const groups = (["necessary", "analytics", "marketing"] as const)
    .map((category) => ({ category, items: entries.filter((e) => e.category === category) }))
    .filter((group) => group.items.length > 0);

  return (
    <LegalPage
      intro="This page lists every cookie and every item of browser storage ReceiptOCR uses, what each one is for and how long it lasts. It is generated from the same list the app is checked against, so it stays complete."
      sections={[
        {
          heading: "What needs your permission",
          body: [
            "Necessary cookies and storage keep you signed in, protect forms, remember your choices and make the signed-in app show your data correctly. They don't need permission, and you can't turn them off here; your browser can still block or delete them, but signing in won't work without them.",
            googleAnalytics
              ? "Google Analytics cookies are optional. They are set only after you choose Accept all, or turn on analytics in Cookie settings. Until then Google's script isn't loaded at all."
              : "We don't use any cookies that need your permission at the moment, so we don't show a cookie banner.",
            "Analytics never runs inside the app or the admin area, where page addresses contain receipt and workspace ids. It runs only on the home, pricing and use-case pages, the sign-in and sign-up pages and these legal pages, and page addresses are sent without anything after the ?.",
          ],
        },
        ...(pageCounts
          ? [
              {
                heading: "Cookie-free page counts",
                body: [
                  "We count visits to public pages with Vercel Web Analytics. It sets no cookies and stores nothing on your device. Vercel tells visits apart with a hash of the request that it discards after 24 hours, and keeps the page, the referring site, the country, and the browser, operating system and device type.",
                  "You can turn page counts off in Cookie settings. Global Privacy Control and Do Not Track turn them off too. When Google Analytics is in use, they stay off until you accept.",
                ],
              },
            ]
          : []),
        {
          heading: "Browser privacy signals",
          body: [
            "If your browser sends Global Privacy Control, we treat it as a request not to sell or share your data and keep Google Analytics and page counts off. We don't sell your data either way.",
            "If your browser sends Do Not Track, we keep all analytics off too.",
          ],
        },
        {
          heading: "Changing your choice",
          body: [
            "Use Cookie settings, below, in the footer of the public pages and the sign-in pages, or in the account menu once you are signed in, to change your choice at any time. Your choice is saved for 6 months, and we ask again sooner if this policy changes what optional tools do. Turning analytics off also deletes the Google Analytics cookies on this site.",
          ],
          links: [{ label: "Privacy policy", href: "/privacy" }],
        },
      ]}
      title="Cookie policy"
      updated={formatLegalDate(LEGAL_UPDATED.cookies)}
    >
      <div className="mt-6">
        <CookieSettingsButton variant="secondary" />
      </div>

      <h2 className="mt-12 text-lg font-semibold tracking-tight">Everything we store</h2>
      {groups.map((group) => (
        <section
          aria-labelledby={`cookies-${group.category}`}
          className="mt-6"
          key={group.category}
        >
          <h3
            className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground"
            id={`cookies-${group.category}`}
          >
            {categoryTitle[group.category]}
          </h3>
          <ul className="mt-3 flex flex-col gap-3">
            {group.items.map((entry) => (
              <li className="rounded-xl border border-border bg-card p-4" key={entry.name}>
                <p className="break-words font-mono text-sm text-foreground">{entry.name}</p>
                {entry.note && <p className="mt-0.5 text-xs text-muted-foreground">{entry.note}</p>}
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{entry.purpose}</p>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="inline text-muted-foreground">Type: </dt>
                    <dd className="inline text-foreground">{kindLabel[entry.kind]}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Set by: </dt>
                    <dd className="inline text-foreground">{entry.setBy}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Lasts: </dt>
                    <dd className="inline text-foreground">{entry.duration}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </LegalPage>
  );
}
