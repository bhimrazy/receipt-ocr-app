# Mobile and installed-app (PWA) review (2026-11-09)

The owner asked on 2026-11-09 for a review of the phone screens so that the installed app looks and feels like a
native app, not a website (STATUS, "Later": _App-like mobile screens_). This review ranks the findings and groups them
into five small PRs. No code changed.

**Scope, in priority order:**

1. The landing page `/`.
2. Sign in, sign up, forgot password, reset password and the code screens.
3. The signed-in shell on phones: tab bar, app bar, Home, Scan, History, receipt detail, Settings and sheets.
4. PWA plumbing: manifest, iOS meta, splash screens, safe areas, standalone mode, viewport, keyboard, offline.

**Method:**

- Read `apps/web/app`, `apps/web/components`, `packages/ui`, `app/manifest.ts`, `public/` and the root layout metadata.
- Took live shots of the public pages on `https://receipt-ocr.bhimraj.com.np` at 375×812 and 390×844, device scale 3,
  in light and dark, with an iPhone user agent and touch on.
- Ran a DOM probe on each page: horizontal overflow, inputs under 16px, tap targets under 44px.
- Did not sign in on production. The signed-in screens are reviewed from the code and from earlier local shots.
- Skills used: design-critique and accessibility-review.

**Standalone emulation did not take effect.** `Emulation.setEmulatedMedia` with `display-mode: standalone` left
`matchMedia('(display-mode: standalone)')` false in this Chromium build. All standalone findings are reasoned from the
code. Every PR below needs a check on a real iPhone and Android phone with the app installed.

**Shots:** `S` = `/tmp/claude-1000/-workspaces-receipt-ocr-app/27a05ff3-085a-4f7d-8cb9-bcc0ee2f1d39/scratchpad`.

- Public pages: `S/pwa-review/shots2/<page>-<375|390>-<dark|light>.png`. The pages are `home`, `sign-in`, `sign-up`,
  `forgot-password`, `reset-password` and `offline-html`.
- Landing page while scrolling: `S/pwa-review/shots2/home-scroll-*.png` (390 wide at 1x).
- Landing page with the menu open: `S/pwa-review/shots2/home-menu-open.png`.
- Signed-in shots from earlier tracks: `S/upgrade-shots/account-sheet-390-*.png` (History behind the account sheet) and
  `S/shots/after-preview-390-*.png` (the capture review screen).

## Overall impression

The shell is closer to native than most PWAs:

- A bottom tab bar with a raised Scan button and a large-title app bar.
- Safe-area padding on every fixed bar and sheet, and swipeable bottom sheets.
- Inputs at 16px on phones. The probe found no text field under 16px on any public page, so iOS never zooms in.
- `one-time-code` on code fields, `theme-color` per scheme, iOS splash screens in both themes, an offline fallback that
  reloads itself, and a share target.
- No horizontal overflow at 375 or 390 on any public page.

The website feel comes from a few places:

- **The edges of the app.** Signing out, the logo, "Back to home" and legal links all land the installed user on the
  marketing site, with its header, hamburger menu, sign-up button and chat bubble.
- **No touch feedback.** The browser's tap highlight is turned off, but buttons only have hover states, and phones never
  show hover. Most taps get no visual response.
- **Auth pages are a form in a card on a page**, followed by a row of footer links and a theme toggle.
- **Dialogs with text fields sit in the middle of the screen**, where the iOS keyboard covers their buttons.

Fixing these four, which are PRs 1 to 3 below and mostly S effort, removes most of the "this is a website" feeling.

## Findings, ranked

Effort: **S** is under half a day, **M** is one to two days, **L** is more.

### 1. The installed app falls back to the marketing site

- **Where:**
  - `/` when opened in standalone mode.
  - Sign-out: `useSignOut` in `components/user-menu.tsx` pushes `/`.
  - The auth logo and the footer "Home" link (`components/auth/auth-layout.tsx`).
  - "Back to home" in `SlimHeader` (`components/legal-page.tsx`).
  - The "Go to the home page" buttons on `not-found`, `account-deleted` and `newsletter-step`.
- **What breaks:** The manifest scope is `/`, so all of these open inside the app window. The installed user sees the
  landing page with its floating header, "Get started free", the hamburger menu, the support bubble and the footer. On
  iOS there is no browser Back button, so the only way back is to find "Open the app" in the header.
- **Why it matters:** Signing out is the most common way to reach this, and the user lands on a sales page inside their
  own app.
- **Fix:**
  - Add a small client island on the marketing routes (`/`, `/pricing`, `/use-cases/*`) that calls
    `router.replace("/app")` when `isStandaloneDisplay()` is true. The `/app` layout already sends a signed-out user on
    to `/sign-in`.
  - Avoid the flash of the landing page: redirect in `proxy.ts` too when the `display_mode=standalone` cookie is present
    (`lib/display-mode.ts`). Keep the client check as a fallback for when the 30-minute cookie has expired.
  - In standalone mode, sign-out pushes `/sign-in` instead of `/`.
- **Effort:** S.
- **Files:** `components/landing-page.tsx`, `app/pricing/page.tsx`, `app/use-cases/*`, `proxy.ts`,
  `components/user-menu.tsx`, `lib/display-mode.ts`.

### 2. Taps get no visual response

- **Where:** Every `Button` (`packages/ui/src/components/button.tsx`), the Home "To check" rows (`app/app/page.tsx`), the
  Settings cards and the links on the auth pages.
- **What breaks:** `styles.css` sets `-webkit-tap-highlight-color: transparent` on `html`, and its comment says
  "controls draw their own pressed state". Most controls don't. The button variants have only `hover:` styles, and
  Tailwind v4 applies `hover:` only on devices that can hover, so on a phone a tap on "Sign in", "Upload" or "Export CSV"
  shows nothing until the next screen loads. The tab bar and the receipt rows (`receipt-list.tsx`) already have
  `active:bg-wash`.
- **Why it matters:** An instant pressed state is the most basic native cue. Without it, slow networks feel broken and
  people tap twice.
- **Fix:** Add `active:` states to `buttonVariants`:
  - Default and destructive: `active:brightness-95 active:scale-[0.98]`, with no scale under `motion-reduce`.
  - Outline, secondary and ghost: `active:bg-wash`.
  - Row links: `active:bg-wash`, the same as the receipt rows.
- **Effort:** S.
- **Files:** `packages/ui/src/components/button.tsx`, `apps/web/app/app/page.tsx`, `apps/web/app/app/settings/page.tsx`.

### 3. Auth screens read as a web form in a card

- **Shots:** `sign-in-390-dark.png`, `sign-in-390-light.png`, `sign-up-390-dark.png`, `reset-password-390-dark.png`.
- **What breaks:**
  - On a phone the form sits in a bordered card, inset 16px from the screen edge, under a centred logo.
  - Below it is a footer with Home, Privacy, Terms, Cookie settings and a three-way theme toggle (`auth-layout.tsx`).
  - The logo links to `/`, which is finding 1.
  - In the installed app this looks like a browser page. Native sign-in screens use the full width, have no card and
    have no website footer.
- **Fix:**
  - Below `sm`, remove the card's border, background, shadow and padding so the form fills the screen. Keep the
    top-anchored layout: it already stops the card jumping when an error appears.
  - In standalone mode, replace the footer with one line ("Privacy · Terms"), drop the theme toggle (it is in Settings
    after sign-in), and render the logo as a plain image instead of a link.
  - The other auth screens already have a full-width primary action within thumb reach once the card padding is gone,
    so they need no sticky button.
- **Effort:** M.
- **Files:** `components/auth/auth-layout.tsx`, `components/auth/auth-field.tsx` (`AuthMessage`),
  `components/auth/credentials-form.tsx`.

### 4. The iOS keyboard covers dialogs with text fields

- **Where:** `DialogContent` is centred with `fixed top-1/2 -translate-y-1/2` (`packages/ui/src/components/dialog.tsx`).
  These dialogs have text fields on phones:
  - The step-up code (`components/step-up/step-up.tsx`).
  - Create workspace (`components/workspace-switcher.tsx`).
  - Change email and password (`components/account-settings.tsx`).
  - Set a password (`components/security/sign-in-methods-card.tsx`).
  - Rename a passkey (`components/security/passkeys-card.tsx`).
  - Groups (`components/groups/groups-manager.tsx`).
- **What breaks:** iOS does not resize the layout viewport when the keyboard opens, so a centred fixed dialog stays
  where it is. On an 844pt screen the keyboard, about 340pt tall, covers the bottom of a 300pt dialog, which is where
  its confirm button is. Android's default (`resizes-visual`) behaves the same way.
- **Fix:**
  - Below `md`, render `DialogContent` as a bottom sheet with the same look and motion as `Drawer`.
  - Lift the sheet above the keyboard: a small `useKeyboardInset` hook in `packages/ui` sets `--keyboard-inset` from
    `visualViewport` resize events, and the sheet uses `bottom: var(--keyboard-inset, 0px)`.
  - Leave alert-style confirmations (`AlertDialog`) centred. iOS centres those too.
- **Effort:** M.
- **Files:** `packages/ui/src/components/dialog.tsx`, a new `packages/ui/src/lib/use-keyboard-inset.ts`.

### 5. Legal pages strand the installed user

- **Where:**
  - Settings → About → Terms or Privacy (`components/about-settings.tsx`).
  - "privacy" in `components/receipt-reading-settings.tsx`.
  - The Terms and Privacy links on sign-up (`credentials-form.tsx`).
- **What breaks:** These open `/terms` and `/privacy` inside the app window, with no tab bar. The only way out is
  `SlimHeader`'s "Back to home", which goes to the landing page (finding 1). Android's system Back works, but iOS has no
  Back.
- **Fix:** In standalone mode, `SlimHeader`'s link becomes "Back" and calls `router.back()`, falling back to
  `/app/settings` when there is no history. Hide `SiteFooter` on these pages in standalone mode.
- **Effort:** S.
- **Files:** `components/legal-page.tsx`, `components/site-footer.tsx`.

### 6. Turnstile is always dark, even in the light theme

- **Shots:** `sign-in-390-light.png`, `sign-up-390-light.png`.
- **What breaks:** `components/turnstile.tsx` passes `theme: "dark"`. When the challenge shows, it is a dark grey block
  on a light page, between the submit button and "Forgot your password?". It uses `appearance: "interaction-only"`, so
  most people never see it. Headless Chromium always triggers it.
- **Fix:** Pass the theme that is actually showing (`document.documentElement.classList.contains("light")`), or use
  `"auto"`.
- **Effort:** S.
- **Files:** `components/turnstile.tsx`.

### 7. The installed app has no way to refresh

- **Where:** `packages/ui/src/styles.css` sets `overscroll-behavior-y: none` under `display-mode: standalone`. That is
  right, because the rubber band looks like a web page. But iOS standalone also has no reload button, and only
  `processing-poller.tsx` refreshes data.
- **What breaks:** Home's counts and History don't change when someone else in the workspace adds receipts, or when the
  app comes back from the background hours later. Native apps refresh on return to the foreground.
- **Fix:** In the app layout, call `router.refresh()` on `visibilitychange` to visible when the page has been hidden
  for more than 60 seconds.
- **Effort:** S. A custom pull-to-refresh on Home and History would be M; that is owner decision 2.
- **Files:** `app/app/layout.tsx`, plus a new small client component next to `processing-poller.tsx`.

### 8. Going offline replaces the whole app with a card

- **Shots:** `offline-html-390-dark.png`, `offline-html-390-light.png`.
- **What breaks:** When the phone is offline, tapping a tab makes Next fall back to a full page load. `sw.js` answers it
  with `offline.html`: a centred card with no tab bar and no app bar. The user loses their place, and the screen looks
  like a browser error page. The page itself is good: it follows the theme, uses safe areas and reloads itself when the
  connection returns.
- **Fix:**
  - Add an `online`/`offline` listener in the app shell that shows a slim "You're offline" bar under the app bar and
    keeps the current screen.
  - Turn Scan's upload button into a short message while offline.
  - Keep `offline.html` as the last resort. The rule against caching signed-in HTML stays.
- **Effort:** S–M.
- **Files:** `app/app/layout.tsx`, a new `components/offline-bar.tsx`, `components/upload-panel.tsx`.

### 9. Long-press on the app's controls selects text and shows link previews

- **Where:** `select-none` is set only on the tab bar, the app bar's Back button and `Button`.
- **What breaks:** A long-press on a Home row, a Settings card title or a page title selects the text. On iOS, a
  long-press on a tab or row link opens Safari's link-preview menu with the URL. Both are clear website tells.
- **Fix:**
  - Add `-webkit-touch-callout: none` to `[data-slot="tab-bar"] a`, `[data-slot="app-bar"] a` and the row links.
  - Add `select-none` to row links and headings in the app shell.
  - Keep data selectable: amounts, merchant names and line items should stay copyable.
- **Effort:** S.
- **Files:** `packages/ui/src/styles.css`, `components/receipt-list.tsx`, `app/app/page.tsx`.

### 10. Screens cut instead of moving

- **Where:** Every navigation in the app.
- **What breaks:** History → receipt and Settings → Security switch instantly; the only feedback is a spinner on the tab
  icon. Native apps slide pushed screens in from the right and fade between tabs. The large-title app bar already looks
  native, so the hard cut is noticeable.
- **Fix:**
  - Turn on `experimental.viewTransition` in Next 16 and wrap detail routes in React's `<ViewTransition>`.
  - Pushes (receipt detail, settings sub-pages) slide in from the right, Back slides them out, and tab switches
    cross-fade over 150ms.
  - Under `prefers-reduced-motion`, nothing moves.
- **Effort:** M.
- **Files:** `next.config.ts`, `app/app/layout.tsx`, `components/app-nav.tsx`.

### 11. Settings is a long document on a phone

- **Where:** `app/app/settings/page.tsx` and `components/settings-section.tsx`.
- **What breaks:** Each section stacks an `h2`, a description and a `Card` with buttons laid out inline, so the page
  reads like a web settings page. Native settings are grouped lists: an icon, a label, the current value and a chevron
  that opens a sub-page. The sub-pages already exist: `security`, `billing`, `members`, `delete-account`.
- **Fix:** On phones, show the sections as grouped rows such as "Plan · Free ›", "Workspace · Sam's ›", "Appearance ·
  System ›" and "Security · 2 methods ›". Each row opens its sub-page, or a sheet for Appearance, and the descriptions
  move there. Desktop keeps the current two-column layout.
- **Effort:** M.
- **Files:** `app/app/settings/page.tsx`, `components/settings-section.tsx`.

### 12. Manifest gaps

- **Where:** `app/manifest.ts`.
- **What's missing:**
  - **`screenshots`.** Chrome on Android shows its richer install dialog only when there is at least one screenshot with
    `form_factor: "narrow"`.
  - **`launch_handler: { client_mode: ["navigate-existing", "auto"] }`.** Without it, the "Add receipt" shortcut and a
    share can open a second app window instead of reusing the open one.
  - **More shortcuts.** There is only one. Add "History" (`/app/history`).
  - **A stale comment.** It says "the app is dark-only", but the Light and System themes have shipped.
- **Why it matters:** These shape the install dialog and the long-press menu on the home-screen icon, which are the
  first things that look native.
- **Fix:**
  - Add two narrow screenshots (Home and a receipt result) made from test data, plus a wide one.
  - Add `launch_handler` and the History shortcut, and fix the comment.
  - `background_color` stays dark (owner decision 4).
- **Effort:** S.
- **Files:** `app/manifest.ts`, `public/screenshots/`.

### 13. On a phone, the landing page shows a desktop browser

- **Shots:** `home-375-dark.png`, `home-scroll-00.png`.
- **What breaks:**
  - `components/product-preview.tsx` draws desktop window controls (traffic lights) and the address
    `receiptocr.app/app/receipts/whole-foods`. That is not our domain (product standards, "Claims"). At 375 it wraps
    under the chat bubble.
  - Someone visiting on a phone is deciding whether to install a phone app, and is shown a desktop browser.
  - "Sign in" is hidden behind the hamburger menu below `sm` (`site-header-bar.tsx`), so a returning user needs two taps
    (`home-menu-open.png`).
- **Fix:**
  - Below `sm`, show the preview in a phone frame: the result screen with the tab bar, and no address bar. Remove the
    made-up domain everywhere.
  - Make "Sign in" a visible text link next to a shorter primary button (owner decision 6).
- **Effort:** M.
- **Files:** `components/product-preview.tsx`, `components/site-header-bar.tsx`, `components/site-header.tsx`.

### 14. Social sign-in in the iOS installed app needs a device test

- **Where:** "Continue with Google" and "Continue with GitHub" in `credentials-form.tsx`, opened in iOS standalone.
- **Risk:** Going to `accounts.google.com` leaves the app's scope, so iOS opens it in an in-app browser sheet. Whether
  the callback's session cookie reaches the installed app's own cookie store has changed between iOS versions. If it
  doesn't, the user ends up signed in inside the sheet and signed out in the app. The app also keeps cookies separate
  from Safari, so everyone who installs on iOS signs in once more inside the app.
- **Fix:** Test on an iPhone first. If it fails, put "Use a passkey" and email first in iOS standalone (passkey already
  comes first on sign-in) and add a one-line note under the social buttons.
- **Effort:** S to test, S–M to fix.
- **Files:** `components/auth/credentials-form.tsx`, `lib/pwa.ts` (`iosBrowser`).

### 15. Small items

- **iPad splash screens.** `lib/ios-splash.ts` covers iPhones only, so iPad launches flash a blank screen first. Add the
  iPad sizes. S.
- **Chat bubble on the landing page.** At 375 it covers the bottom-right corner of the preview card and the fake
  address. Give the page a bottom inset that matches the bubble, or hide the bubble until the user scrolls past the
  hero. S.
- **Tab labels at 11px.** The tab bar labels use `text-2xs` (11px). That matches iOS (10pt) and Android (12sp) and
  passes contrast. No change.
- **Status bar.** The `statusBarStyle: "default"` decision in `app/layout.tsx` holds: pages start below the status
  bar, and `theme-color` follows the theme. Changing it is owner decision 5.

## Five PRs, in build order

| # | PR                                                       | Findings           | Effort | Notes                                                                                |
| - | -------------------------------------------------------- | ------------------ | ------ | ------------------------------------------------------------------------------------ |
| 1 | **The installed app never shows the website**            | 1, 5               | S      | Standalone redirect on marketing routes, sign-out to `/sign-in`, Back on legal pages |
| 2 | **Touch feedback and controls that don't act like text** | 2, 9, 6            | S      | `active:` states in `packages/ui`, touch-callout and selection, Turnstile theme      |
| 3 | **Full-screen auth on phones**                           | 3, 14              | M      | No card below `sm`, a slim footer in standalone, iPhone OAuth test first             |
| 4 | **Keyboard, offline and refresh**                        | 4, 8, 7            | M      | Bottom-sheet dialogs with keyboard inset, offline bar, refresh on return             |
| 5 | **Polish**                                               | 12, 13, 10, 11, 15 | M–L    | Manifest, phone preview on the landing page, view transitions, grouped Settings      |

Each PR needs before and after shots at 390 and 1440, in light and dark, plus a pass on a real installed iPhone and
Android phone. Headless Chromium can't show standalone mode, the keyboard or the status bar.

PR 5 is the largest and can be split. If it is, ship the manifest and landing preview first, because people see those
before they install.

## Owner decisions

**Decided 2026-11-09: the owner accepted every recommendation below.** Decisions 8 and 9 are tasks: the iPhone OAuth
test comes before PR 3, and the screenshots come with PR 5.

PR 1 detects the installed app per window (`display-mode: standalone`, or `navigator.standalone` on older iOS) in a
blocking `<head>` script, not by the `display_mode` cookie that finding 1 suggests. Android and desktop Chrome share
cookies between the installed app and browser tabs, so a cookie would also redirect the website for 30 minutes.

1. **Send the installed app from `/` to `/app`.** Recommended: yes, both server-side (by the cookie) and client-side.
   Without it, the installed app can still reach the marketing page.
2. **Pull-to-refresh.** Recommended: refresh when the app returns to the foreground (finding 7) and no custom gesture
   for now. Add one later if testers ask for it.
3. **Screen transitions.** These use a Next 16 experimental flag. Recommended: yes, for push and pop only, built after
   PRs 1 to 4, and easy to switch off.
4. **Splash background on Android.** The manifest's `background_color` can't follow the theme. Recommended: keep dark,
   since the brand is dark-first. Light-theme users see a dark splash for a moment.
5. **iOS status bar style.** Recommended: keep `default`. `black-translucent` puts the app under the status bar, which
   looks more native, but it needs every screen to handle the top inset and has no clear payoff.
6. **Landing page header on phones.** Recommended: show "Sign in" as a text link and shorten the button to "Start
   free". This is a copy change on the main call to action.
7. **Settings as a grouped list on phones.** Recommended: yes, on phones only.
8. **iPhone OAuth test (finding 14).** This needs the owner's iPhone with the app installed. Test Google and GitHub
   before PR 3.
9. **Install-dialog screenshots.** These need two or three test-data screenshots of Home and a receipt result.
   Recommended: make them from the compose stack with sample receipts.
