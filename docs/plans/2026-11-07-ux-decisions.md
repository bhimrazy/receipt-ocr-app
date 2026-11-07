# UX decisions: mobile navigation, install prompt, name, push

_Plan · 2026-11-07 · status: proposed, nothing built_

Four open UX questions, each with a recommendation first, then the options, the evidence (sources dated; anything not
checked against a primary source is marked **unverified**) and the implementation tasks.

## Summary

| Question          | Recommendation                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile navigation | **(b)**: five slots, Home · History · **Scan (centred)** · Groups · Settings; tap the workspace name in the top bar to switch; avatar sheet stays. No drawer.                                     |
| Install prompt    | iOS can't be triggered programmatically (WebKit opposed as of May 2026). Offer after the first receipt is read, snooze 30 days then stop, keep a permanent "Install app" row, iOS 26-aware guide. |
| Name              | **ReceiptOCR** everywhere a person reads it (text, PWA `name`/`short_name`, email From). Wordmark stays two-tone: `Receipt` + emerald `OCR`. Revisit a distinctive name before paid marketing.    |
| Push              | **Later.** Build when batch capture or an async flow exists and telemetry shows people leaving before work finishes. Ask from a tap on that screen, never on load.                                |

## 1. Mobile navigation

**Recommendation.** Ship option (b): a five-slot bottom bar, **Home · History · Scan · Groups · Settings**, with Scan
in the true centre (two tabs each side), the workspace name in the top bar becoming a button that opens the workspace
switcher, and the avatar keeping the account sheet (account, usage, Admin, cookie settings, sign out). Don't add a
left drawer. The owner's ask for "a sidebar" is really an ask for what the sidebar holds (every section, the workspace
switcher, usage, account), and all of that already fits on a phone: four sections in the bar, workspace one tap away
on the name, the rest in the avatar sheet. A drawer would add a second, hidden navigation system in the hardest place
to reach, duplicating the bar, on a platform (iOS) with no drawer convention and on Android, where Material has
deprecated it. Tablets at `md` and up keep the real sidebar. Add Groups to the desktop sidebar too, so both shells
list the same sections.

### Today (code read 2026-11-07)

- `apps/web/components/app-nav.tsx`: `APP_NAV` = Home, History, Settings; `AppTabBar` inserts Scan after
  `Math.ceil(3 / 2) = 2` items, so the bar is Home · History · **Scan** · Settings: Scan sits in slot 3 of 4, left of
  centre. `BottomTabBar` already supports a `more` drawer, unused.
- Groups (`/app/groups`) has no tab or sidebar link; it is reached from History's "Manage groups" and `isActive`
  counts it as History.
- Workspace switching already exists on phones, in `AccountSheet` (`apps/web/components/user-menu.tsx`), behind the
  avatar. The top bar shows the workspace name as plain text (`MobileTopBar` `context`), which looks tappable but
  isn't.
- Back on detail pages comes from `backFor` / the top bar, so standalone mode (no browser back button) is already
  covered on iOS; Android has the system back gesture.

### Options

| Option                                                  | For                                                                                                                                   | Against                                                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Left drawer mirroring the sidebar, plus tabs        | Matches the owner's mental model and desktop; room for any number of sections                                                         | Two navigation systems for four sections; drawer trigger top-left (worst thumb reach); hidden nav less discoverable; no iOS convention; deprecated in Material 3 Expressive; edge-swipe conflicts with iOS back swipe |
| **(b) Five slots, centred Scan, workspace on the name** | Every section visible; Scan centred and reachable; switcher where people look for it (Notion, Slack-style); matches HIG and M3 counts | Five is the ceiling: a sixth section needs a More tab or a rethink; Groups gets a slot before we know its usage                                                                                                       |
| (b′) Five slots with "More" instead of Settings         | Room for future sections                                                                                                              | Hides Settings behind one more tap; "More" is the least-informative label; nothing needs it yet                                                                                                                       |
| (c) Keep four slots, Groups as a History segment        | No new tab; groups are a way of filtering History                                                                                     | Three tabs + Scan can't put Scan in the centre; Groups stays semi-hidden                                                                                                                                              |

Why Settings rather than "Account" in the fifth slot: the avatar top-right already opens the account sheet (the
pattern Gmail, Google Drive and the App Store use; **unverified** for current versions, from general knowledge), and
Settings is a page with sub-pages (Members), which tabs suit. If the owner prefers one place for "me", fold Settings
into the avatar sheet later and give its slot to whatever section is used next most.

### Evidence

- **Hidden navigation is less discoverable.** NN/g's quantitative study (179 participants, 6 sites, Dec 2015; articles
  Jun–Jul 2016): hiding the main navigation roughly halved discoverability on desktop; on mobile the gap was smaller
  but real: the hidden-nav site had 44% navigation use and 33 s to first use, versus 89% / 24 s for a combo
  (partly visible) design. NN/g's advice: with 4–5 top-level options, show them all.
  [NN/g, Hamburger menus and hidden navigation](https://www.nngroup.com/articles/hamburger-menus/);
  [NN/g, Find navigation on mobile, 2016-07-24](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/).
  Caveat: this is a 2016 study of content websites, not app shells; the direction has held in later NN/g writing,
  but the numbers are old.
- **Platform conventions.** Android's layout guidance: a navigation bar for 3–5 equally important destinations; a
  drawer can hold more but is "not as ideal" on compact screens because people must reach to the top bar
  ([Android Developers, layout and nav patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns),
  read 2026-11-07). Material 3 Expressive (May 2025) deprecates the navigation drawer in favour of the expanded
  navigation rail, which targets medium and larger windows; phones keep the bar
  ([9to5Google, 2025-05-14](https://9to5google.com/2025/05/14/material-3-expressive-navigation/); Material
  Components Android docs, via a mirror, so treat the exact wording as **unverified**). Apple HIG: tab bars for
  top-level peer sections, about five on iPhone, and actions belong in toolbars rather than as tabs
  ([HIG, Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars); the page didn't render
  for the fetch, so this is **unverified** against today's text). Our raised Scan slot is an action inside the bar,
  which bends the HIG rule; it's the pattern Expensify uses (below) and the app's main job, so keep it, but keep it a
  link to a page (it is), not a modal.
- **Thumb reach.** Steven Hoober's observation studies (2013, ~1,300 people) found most phone use is one-handed or
  cradled with the thumb, and the top corners are the hardest to reach on large phones (**unverified** figures,
  from general knowledge; secondary summary in
  [Smashing Magazine, 2019-08](https://www.smashingmagazine.com/2019/08/bottom-navigation-pattern-mobile-web-pages/)).
  A top-left drawer trigger is the worst spot; the bottom bar is the best.
- **Leading apps.** Expensify (help centre, read 2026-11-07): on mobile, bottom tabs Home, Inbox, Reports,
  Workspaces, Account, plus a green receipt/scan button
  ([Navigating New Expensify](https://help.expensify.com/articles/new-expensify/getting-started/Navigating-New-Expensify)).
  Slack's 2020 redesign removed its hamburger for four bottom tabs and moved DMs out of a hidden swipe
  ([Slack blog](https://slack.com/blog/simpler-more-organized-slack-mobile-app); [Computerworld, 2020](https://www.computerworld.com/article/3543788/slack-mobile-app-gets-ui-refresh-for-easier-navigation.html)).
  Notion switches workspaces from the workspace name at the top of its sidebar/home (**unverified**, general
  knowledge). Gmail still uses a drawer, but for an unbounded list of labels, which we don't have.
- **Standalone PWA.** Installed on iOS there is no browser chrome or back button; navigation must be complete in the
  app. Our top-bar Back (`backFor`) already handles detail pages. A drawer doesn't help here; visible tabs do.

### Tasks

1. `apps/web/components/app-nav.tsx`: add `{ href: "/app/groups", label: "Groups", icon: FolderOpen | Tags }` to
   `APP_NAV` (order Home, History, Groups, Settings so `half = 2` puts Scan in slot 3 of 5); stop counting
   `/app/groups` as History in `isActive`; drop `/app/groups` from `backFor` (it becomes top-level) and point
   History's "Manage groups" link at the tab. `labelFor` already names it.
2. `MobileTopBar` `context` → a button (`aria-label="Switch workspace, current: <name>"`, chevron icon) that opens a
   workspace sheet built from `WorkspaceList` (`apps/web/components/workspace-switcher.tsx`). With one workspace and
   no permission to create, render plain text, as now.
3. `apps/web/app/app/layout.tsx`: pass the workspace data to the top bar; desktop sidebar picks up Groups through
   `APP_NAV` automatically.
4. Keep `AccountSheet` as is (workspace list may stay there too, as a second route; decide in review).

Acceptance: at 320, 375 and 390 px wide the five slots fit with labels on one line, each ≥ 44×44 px; Scan's centre is
within 1 px of the viewport centre; `aria-current` is set on Groups at `/app/groups`; the workspace button is
reachable by keyboard and VoiceOver, opens a sheet, and switching closes it and re-renders; Playwright e2e covers
tab navigation and switching at 390 px; no drawer component added.

## 2. PWA install prompt

**Recommendation.** iOS install can't be triggered by a site in 2026: Safari has no `beforeinstallprompt`, and WebKit
stated on 2026-05-25 that it still opposes the Web Install API and `<install>` element. What changed in iOS 26 is
that **every** site added to the Home Screen opens as a web app by default (an "Open as Web App" toggle, on by
default), and Safari's default Compact layout moved Share behind the `•••` button, so our current one-line iOS hint
("Tap the Share button") is wrong for most iOS 26 users. Change four things: (1) show the offer **after the first
receipt is read** (status `completed` on the result page) or on the second signed-in day, never on first load;
(2) **snooze, don't bury**: the first dismissal hides it for 30 days, the second for good; (3) add an always-available
**"Install app"** row in the account sheet, the desktop account menu and Settings, shown when not running standalone;
(4) replace the iOS line with a short illustrated guide that covers iPhone (iOS 26 Compact: `•••` → Share → Add to
Home Screen; older/Top layout: Share), iPad (Share in the top toolbar) and Chrome on iOS, and tells in-app browsers to
open in Safari. Keep the prompt in the app only; the landing page gets at most a passive "Works as an app on your
phone" line, not a prompt.

### Today (code read 2026-11-07)

- `apps/web/components/pwa.tsx`: captures `beforeinstallprompt` only on `/app` paths, shows a card at once (mobile:
  above the tab bar; desktop: bottom-right), one-tap install on Chromium; iOS Safari gets one line of text.
- `apps/web/lib/pwa.ts`: `isIosSafari` excludes Chrome/Firefox/Edge on iOS and in-app browsers, so they get nothing;
  one `localStorage` flag, so any dismissal is permanent and there's no way back except the browser menu.

### Options

| Choice    | Options                                               | Pick and why                                                                                                                                        |
| --------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timing    | On load · after first receipt read · after N sessions | **After first receipt read**, or second day signed in, whichever is first: web.dev's "after a conversion" pattern; the user has just seen the value |
| Dismiss   | Permanent · session · snooze                          | **30-day snooze, then permanent**: mirrors web.dev's "respect dismissal, re-ask only after more engagement"; Chrome's own infobar waits ~90 days    |
| Placement | Card · banner · in-flow on the result page · menu row | **In-flow card under the receipt result** (no overlap with the tab bar or page actions) + **permanent menu row**                                    |
| iOS help  | One line · illustrated sheet · video                  | **Illustrated sheet** (2–3 steps, real icons), variant per browser/device                                                                           |
| Where     | Landing · sign-up · app                               | **App only**: installing before sign-up lands people on a sign-in screen in a standalone window                                                     |

### Evidence

- **No programmatic install on iOS.** WebKit (Marcos Caceres, 2026-05-25): "WebKit remains opposed to the addition of
  the Install APIs and `<install>` element", installation "needs to be mediated by browser UI"
  ([public-webapps, 2026-05-27](https://lists.w3.org/Archives/Public/public-webapps/2026AprJun/0011.html)); earlier
  WebKit standards position "oppose" (issue #463). Chromium is running the Web Install API (`navigator.install`) as
  an origin trial, extended in Apr 2026
  ([blink-dev](https://groups.google.com/a/chromium.org/g/blink-dev/c/jsXI0W8R3Dc)). Not usable on iOS; not worth
  adopting on Chromium while `beforeinstallprompt` works.
- **iOS 26 Home Screen change.** WebKit's Safari 26 beta post (WWDC, June 2025) and heise (2025-10-10): any site added
  to the Home Screen now opens as a web app by default, with no manifest or service worker required; an "Open as Web
  App" switch saves a bookmark instead; manifest icons and settings still apply
  ([heise](https://heise.de/-10749652); [WebKit, News from WWDC25](https://webkit.org/?p=16993)).
- **Where Share is on iOS 26.** In Safari's default Compact layout the Share button isn't on the bar: tap `•••` next
  to the address bar → Share → scroll → Add to Home Screen; the Top layout keeps a Share button
  ([iThinkDiff, iOS 26](https://www.ithinkdiff.com/add-web-app-bookmark-iphone-home-screen-ios-26/);
  [Glide community](https://community.glideapps.com/t/ios-26-add-to-home-screen-workflow-change/84599);
  [MacRumors, 2025-06-18](https://www.macrumors.com/2025/06/18/safari-changes-on-ios-26/)). Secondary sources; exact
  labels and whether Add to Home Screen needs "View More" are **unverified** on a real iOS 26.x device. iPad Safari's
  Share sits in the top toolbar (**unverified** for iPadOS 26). We can't detect the user's Safari layout, so the
  guide shows "`•••` or Share" in one step.
- **Other iOS browsers.** Since iOS 16.4, third-party browsers can offer Add to Home Screen from their share sheet
  ([WebKit, 2023-02-16](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)); Chrome for iOS
  added it in 2023 (share icon in the address bar,
  [gHacks](https://www.ghacks.net/?p=198976)). A 2025 How-To Geek piece contradicts that, and Firefox's support is
  only evidenced by a bug thread ([firefox-ios #15172](https://github.com/mozilla-mobile/firefox-ios/issues/15172)):
  **unverified**, test both before writing their steps; until then tell them "use Safari".
- **Timing and dismissal.** web.dev: only show install UI after `beforeinstallprompt` fires; don't show it on load or
  out of context; right after a conversion is "an excellent opportunity"; remember a dismissal and don't re-show
  unless engagement rises; Chrome's mini-infobar returns ~90 days after dismissal
  ([web.dev, Patterns for promoting PWA installation](https://web.dev/articles/promote-install), read 2026-11-07).
- **Measure, don't guess.** We don't know our install rate. Record `offer shown / accepted / dismissed / appinstalled`
  and launches in `display-mode: standalone` through the analytics decided in `feat/consent-analytics` (in-app
  analytics is an open owner decision, so this may wait).

### Tasks

1. `apps/web/lib/pwa.ts`: replace the boolean with `{ dismissals: number, until: ISO date }`
   (`receiptocr.install`); `installSnoozed(now)`; first dismissal → +30 days, second → permanent. Add
   `iosBrowser(ua, touch)` returning `"safari" | "chrome" | "other"` and `isIpad`. Keep try/catch around storage.
   Unit tests for each UA string (iPhone Safari, iPadOS desktop UA, CriOS, FxiOS, Instagram/GSA in-app).
2. `apps/web/components/pwa.tsx`: split into `useInstallOffer()` (state: available? kind?) and two surfaces, a card
   and a menu row. The card shows only after `receiptocr.first-read` is set (or the second day), not on first load.
3. `apps/web/components/receipt-result.tsx`: when a receipt is `completed` and it's the user's first (flag in
   storage), render the install card in-flow below the result.
4. `apps/web/components/user-menu.tsx` (`AccountSheet`, `UserMenu`) and `apps/web/app/app/settings/page.tsx`: an
   "Install app" row while not standalone; Chromium → `prompt()`; iOS → guide sheet; otherwise hidden.
5. New `apps/web/components/install-guide.tsx`: drawer with 2–3 numbered steps and lucide icons (`Ellipsis`, `Share`,
   `SquarePlus`) per variant; in-app browsers get "Open this page in Safari".
6. Copy pass with the name change (§3): "Install ReceiptOCR".

Acceptance: no install UI on the first visit to `/app`; after the first completed receipt the card appears once, in
the page flow, not over the tab bar; dismissing hides it for 30 days (test with a mocked clock), a second dismissal
for good; the menu row is always present when not standalone and absent when installed; on iOS 26 Safari (real
device or BrowserStack) the guide's steps match the screen in both Compact and Top layouts; Playwright covers the
Chromium path with a synthetic `beforeinstallprompt`.

## 3. App name spelling

**Recommendation.** Use **ReceiptOCR** wherever a person reads the name: body copy, page titles, PWA `name` and
`short_name`, `appleWebApp.title`, Open Graph `siteName`, and the email From display name
(`ReceiptOCR <noreply@…>`). Keep the wordmark's two-tone styling with a capital R: `Receipt` in foreground,
`OCR` in emerald, monospace. Lowercase "receiptOCR" breaks at the start of a sentence (either "receiptOCR reads…",
which looks like a typo, or "ReceiptOCR", which makes two spellings), and a lowercase brand only works when the
wordmark carries it everywhere, which emails, home-screen labels and search results don't. "Receipt OCR" with a space
is worse: in text it can't be told from the generic term ("our receipt OCR"). Separately, and later: "receipt OCR" is
the generic name of the category, so the name is weak as a trademark and as a search term. Choose a distinctive name
before spending on marketing or registering a mark; renaming is cheap now (pre-launch, no installed base) and gets
more expensive with every user, link and app install.

### Options

| Spelling       | Sentence start      | Home screen (≤ ~12 chars) | Generic-term confusion          | Notes                                     |
| -------------- | ------------------- | ------------------------- | ------------------------------- | ----------------------------------------- |
| receiptOCR     | Awkward or split    | Fits (10)                 | Low in text, none in speech     | Today: 113 mentions in TS/TSX, 18 in docs |
| **ReceiptOCR** | **Reads as a name** | **Fits (10)**             | Low in text, none in speech     | Closed compound marks it as a name        |
| Receipt OCR    | Fine                | Fits (11)                 | High: identical to the category | 5 mentions today                          |
| New name       | —                   | —                         | None, if chosen well            | Needs research, domain, mark search       |

### Evidence

- **Distinctiveness.** Under US practice a term that merely describes the goods is refused on the Principal Register
  (Lanham Act §2(e)(1), TMEP §1209) and a generic term can't be registered at all, with or without a disclaimer
  (TMEP §1209.01(c)) ([TMEP 1209 via BitLaw](https://www.bitlaw.com/source/tmep/1209.html), older edition; check the
  current TMEP on uspto.gov). "ReceiptOCR" for receipt-OCR software is very likely descriptive or generic; the space
  or camel case doesn't change that. Not legal advice; Nepal and other jurisdictions are **unverified**.
- **Crowded search space.** App stores already list "Receipt Scanner · OCR Scan", a "Receipt OCR Scanner" and many
  similar names (search 2026-11-07, e.g. [App Store listing](https://apps.apple.com/app/id6758623737)). Ranking for
  the brand means ranking for the category; a brand search can't send people only to us.
- **Screen readers.** How VoiceOver, TalkBack and NVDA pronounce "ReceiptOCR" vs "receiptOCR" is **unverified**:
  screen readers often split on a lower-to-upper case change and spell short all-caps runs, which would give
  "Receipt O C R" for both, but this depends on the engine. Test on VoiceOver (iOS) and TalkBack before shipping. If
  one reads it badly, fix only the wordmark (a visually hidden "Receipt OCR" beside the styled text marked
  `aria-hidden`); don't respell body copy for screen readers, since that also changes braille output.
- **Email.** The From display name is set by `EMAIL_FROM` (`docs/production-environment.md` documents
  `receiptOCR <noreply@receipt-ocr.bhimraj.com.np>`), so the change is an env value the owner sets in Vercel, plus
  the doc.
- **Installed apps.** iOS stores the name chosen at Add to Home Screen; changing the manifest doesn't rename existing
  installs (**unverified** whether iOS 26 refreshes it). Chrome on Android can pick up manifest name changes through
  its update check (**unverified** timing). Pre-launch, so no real impact.

### Tasks

1. One PR, mechanical: replace `receiptOCR` with `ReceiptOCR` in user-facing strings (`apps/web/**`, email templates,
   `packages/*`), `apps/web/app/manifest.ts` (`name`, `short_name`), `apps/web/app/layout.tsx` (`title.template`,
   `applicationName`, `openGraph.siteName`, `appleWebApp.title`), and docs. Leave identifiers and storage keys
   (`receiptocr.*`) alone.
2. `apps/web/components/brand.tsx`: `Receipt<span class="text-primary">OCR</span>`.
3. `docs/production-environment.md`: `EMAIL_FROM` example → `ReceiptOCR <noreply@…>`; owner updates the Vercel
   value.
4. Normalise the 5 "Receipt OCR" mentions in TS/TSX to ReceiptOCR where they name the product; the repo and package
   names (`receipt-ocr`) stay.
5. Later, a separate decision: a naming brief (distinctive, pronounceable, domain + app-store + trademark search).

Acceptance: `grep -rn "receiptOCR"` finds no user-facing strings; manifest, title template and email From show
ReceiptOCR; the wordmark reads ReceiptOCR; VoiceOver and TalkBack readings recorded in the PR.

## 4. Push notifications

**Recommendation.** Not now. A single receipt reads in about 3 s at p50 and 10–13 s at p95 (benchmark 2026-11-07,
six fixtures), so the person is still looking at the screen; a notification adds nothing and asking for permission
costs trust. Push becomes worth building when work routinely finishes after people leave: batch capture (`feat/capture`,
up to 10 per batch, two uploads at a time), long receipts, retries that wait out a provider cooldown in the job queue,
or anything that waits on another person (approvals, invites). The trigger: batch capture has shipped **and**
telemetry shows a meaningful share of batches finishing while the page is hidden. Then ask from a tap on the batch
progress screen ("Notify me when these are read"), with our own explanation first and the system prompt only from that
tap; on iOS only inside the installed app (16.4+), and only show the option there. Until then, email covers the rare
slow events.

### What would be worth a notification

| Event                                     | Value                      | Now?                       |
| ----------------------------------------- | -------------------------- | -------------------------- |
| Batch finished (n read, k need a look)    | High once batches exist    | After `feat/capture`       |
| A receipt couldn't be read / needs review | Medium                     | Bundle into the batch note |
| Invited to a workspace                    | Low: email already does it | No                         |
| Monthly summary / spending                | Low; email is better       | No                         |
| Quota reset                               | Low, marketing-ish         | No                         |

### Evidence

- **iOS needs the installed app and a user gesture.** Web Push on iOS/iPadOS 16.4+ works only for Home Screen web
  apps and the permission request must come from direct user interaction
  ([WebKit, 2023-02-16](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). So push depends on
  §2's install rate; on iOS it reaches only people who installed.
- **Declarative Web Push** (iOS/iPadOS 18.4, 2025-03-27): notifications without a service worker, JSON payload with a
  `web_push` key, backwards compatible with classic push
  ([WebKit](https://webkit.org/blog/16535/meet-declarative-web-push/)). Use that payload shape so iOS works even if
  the worker is killed (our runbook has a kill switch). Still needs an `applicationServerKey` (VAPID).
- **Asking cold gets blocked.** Chrome's quieter permission UI (Chrome 80, Jan 2020) kicks in automatically for sites
  with very low acceptance, and the Chromium team notes that prompts on arrival get very low acceptance
  ([Chromium blog](https://blog.chromium.org/2020/01/introducing-quieter-permission-ui-for.html)). Priming with an
  in-app explanation first is the common practice; the 2–3× opt-in figures quoted for it are vendor claims, not
  studies ([Braze](https://www.braze.com/resources/articles/whats-a-push-primer.md)) — directional only.
- **Latency.** `bench/results/2026-11-07.md`: Claude Haiku/Sonnet/Opus 5.5 p50 2.5–3.3 s, p95 9.6–13.3 s. The
  production chain now defaults to Sonnet 5.5 (#93).

### Cost when we build it (estimate, two or three PRs)

- VAPID key pair as a versioned secret (Sensitive in Vercel); `push_subscriptions` table (user, workspace, endpoint,
  keys, user agent, created, last success) — a migration after the baseline; delete on 404/410.
- A `push.send` job kind in `packages/core/src/jobs/kinds` (retries, no `after()`), enqueued when a batch's last
  receipt completes; the push library is a new dependency to vet under the supply-chain rules (or hand-roll RFC 8291
  encryption with `node:crypto`; compare in that PR).
- `apps/web/public/sw.js`: `push` and `notificationclick` handlers (open `/app/history?batch=…`); Declarative payload
  for Safari.
- Settings → Notifications (per device, off by default; test notification); wide-event fields for subscribe,
  send and failure, with the field audit (endpoints are per-device identifiers: treat as personal data, never log
  them).
- Privacy policy: name the push services (Apple, Google, Mozilla) as recipients of encrypted payloads.

### Tasks now (small, measurement only)

1. When batch capture lands, record on the batch's wide event whether the page was hidden when the last receipt
   completed (new field in `packages/core/src/telemetry/schema.ts`, no PII) and how long processing took.
2. Revisit this section with that data; if a meaningful share (owner to set, e.g. one in five batches) finishes
   hidden, schedule the push PRs above.

Acceptance (for now): the field exists and shows on the Admin Operations view or a saved query; no permission prompt
anywhere in the app.

## Open questions for the owner

1. Navigation: Settings or Account in the fifth slot (recommended Settings, avatar keeps the account sheet).
2. Install: is a 30-day snooze then permanent right, or never-permanent while the menu row exists?
3. Name: ReceiptOCR now; commission a distinctive name before paid marketing, yes or no?
4. Push: agree to wait for batch capture data?
