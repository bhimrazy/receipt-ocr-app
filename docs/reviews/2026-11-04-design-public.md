# Design review: public views (2026-11-04)

Scope: `/`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/privacy`, `/terms`, 404.
Method: the dark full-page shots at 1440 and 390@2x, plus new captures at 768, the open mobile menu, focus and error states, and a DOM probe (tap targets, landmarks, computed styles, contrast math).
Skills applied: design-critique, accessibility-review (WCAG 2.1 AA), ux-copy, web-design-guidelines. I did not fetch the remote guideline file and used its known rule set instead.
Content claims ("100% of line items", BYOK) are covered in `2026-11-04-product.md` and not repeated here.

Shots: `S` = `/private/tmp/claude-501/-Users-bhimrajyadav-Developer-Personal-receipt-ocr-app/c8a0eaeb-1e13-4c81-a67d-81a5df0c7ddb/scratchpad/shots`, with the originals in `S/public/` and the new captures in `S/design/`.

Severity: **owner-blocking** (fix before showing anyone) · **polish** · **idea**.

## Overall impression

The bones are good: the emerald accent is restrained, mono is used for data, the type scale is tight (DM Sans and JetBrains Mono) and the text tokens pass AA everywhere I measured. The product-preview card is the strongest thing on the page because it shows the real output.
Three things undercut the premium feel:
1. A theme bug that removes every coloured border.
2. A stock Next.js 404.
3. A section rhythm that looks like a template: centred label, H2, subtitle and card grid, five times in a row.

## Owner-blocking

**B1. Every `border-*` colour utility is silently ignored, including the input focus state.**
- Evidence: `packages/ui/src/styles.css:42-44` sets `* { border-color: var(--border) }` outside any layer. Tailwind v4 utilities live in `@layer utilities`, and unlayered CSS beats them. The probe shows `border-primary/40`, `border-primary/20`, `border-white/10` and `focus:border-primary` all computing to `rgb(39,39,42)`.
- What it breaks:
  - A focused input looks the same as an idle one (`S/design/signin-focus-email.png`, Password is focused). This fails WCAG 2.4.7.
  - The featured Free plan border (`landing-page.tsx:185`).
  - The emerald icon-tile borders (`:300`, `:361`).
  - The error-box border (`credentials-form.tsx:185`).
  - The card hover border (`landing-page.tsx:296`).
  - The `border-white/10` glass edges on the auth and preview cards.
- Fix: `@layer base { *, ::before, ::after { border-color: var(--border); } }`. Then re-check every screen, because the design will visibly change, mostly for the better.

**B2. The 404 is the unstyled Next default: black, system font, no brand, no way back.**
- Evidence: `S/public/does-not-exist@1440.png`. There is no `apps/web/app/not-found.tsx`.
- Fix: add `app/not-found.tsx`:
  - `<main className="relative grid min-h-screen place-items-center px-5">`
  - the `grid-mask`/`receipt-grid` backdrop
  - `<Brand/>`
  - a mono `404` in `text-primary font-mono text-sm tracking-[0.22em]`
  - an H1 "This receipt didn't scan", or plain "Page not found"
  - `Button` "Back to home" plus an outline button "Go to app"
- Reuse the `LegalPage` header so it reads as part of the site.

**B3. Input focus also has no ring, and input boundaries fail non-text contrast.**
- Evidence: `packages/ui/src/components/input.tsx:9` uses `outline-none … focus:border-primary` with no ring, even after B1 is fixed. The `#27272a` border on `#141416` measures 1.24:1, against the 3:1 that WCAG 1.4.11 requires.
- Fix:
  - Replace with `focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-primary`, matching the Button ring.
  - Add an `--input: #6b6b74` token (3.49:1) and use `border-input` for inputs only. Leave `--border` subtle for cards.

**B4. Placeholder-as-label on every auth form.**
- Evidence: `credentials-form.tsx:146-175`, `forgot-password-form.tsx:62-70`, `reset-password-form.tsx:61-80`. `aria-label` keeps screen readers working, but the label vanishes as soon as someone types. Sign-in also shows "Password (min. 8 characters)", which is a sign-up rule (`:171`).
- Fix:
  - Add a visible `<label className="text-xs font-medium text-muted-foreground">` above each field in a `flex flex-col gap-1.5` wrapper. Move "Forgot your password?" into the Password label row (`flex justify-between`).
  - Sign-in placeholder: drop the hint. On sign-up, show "At least 8 characters" as helper text tied with `aria-describedby`.

**B5. The public legal pages say they are template copy.**
- Evidence: `S/public/privacy@1440.png`, `legal-page.tsx:54-57`: "This is template legal copy … Replace it before any production launch."
- This is the single biggest trust breaker for a product that handles financial documents. Gate it behind `process.env.NODE_ENV !== "production"`, or remove it once the copy is reviewed.

**B6. The footer "Create a free account" link goes to `/sign-in`.**
- Evidence: `site-footer.tsx:17`.
- Fix: point it at `/sign-up`. "Upload a receipt" (`:19`) sends logged-out visitors through an auth redirect; label it "Open the app", or drop it.

## Polish: layout and hierarchy

**P1. 768px header collision.**
- Evidence: the centred absolute nav ends at x=552 and "Sign in" starts at x=550 (`S/design/header768.png`). "FAQ" and "Sign in" run together, and they use two different sizes (`text-sm` nav, `text-xs` from `size="sm"`).
- Fix: `site-header.tsx:64`: `hidden … lg:flex`, and `:113` `lg:hidden` (and on the mobile `<nav>` at `:121`), so tablet gets the menu. Give the ghost Sign in `text-sm`.

**P2. The product-preview quantity column zig-zags.**
- Evidence: in `product-preview.tsx:65-70`, `justify-between` across three children puts "1.2 kg", "2", "1" and "3" at different x positions (`S/design/home390-00.png`, also at 1440). That is the one place the "structured data" promise should look structured.
- Fix: `grid grid-cols-[1fr_4rem_5rem] items-center gap-3` with `text-right tabular-nums` on qty and price.

**P3. The preview URL wraps on mobile ("whole-\nfoods").**
- Evidence: `product-preview.tsx:23`.
- Fix: `min-w-0 truncate`, and shorten it to `receiptocr.app/r/whole-foods`, or hide the path below `sm` (`hidden sm:inline`).

**P4. Hero on mobile.**
- Evidence: the H1 breaks into three lines with an orphaned "data" (`S/design/home390-00.png`), the two CTAs stack at different widths, and the mono footnote wraps into a ragged two-liner. Source: `landing-page.tsx:232-252`.
- Fix:
  - `text-[2.75rem] sm:text-5xl md:text-7xl` so "structured data" fits on one line at 390.
  - CTA row `flex-col sm:flex-row` with each button `w-full sm:w-auto`, inside a `max-w-xs mx-auto` wrapper.
  - Footnote: keep "No card required" only below `sm`.

**P5. Template rhythm.** Features, How it works, Use cases, Pricing and FAQ all use the identical centred header plus card-grid pattern with the same 44px emerald icon tile. Feature cards also lift on hover (`landing-page.tsx:296`) although they are not links, which suggests clickability falsely. Fixes, in order of value:
- (a) Remove the hover lift and glow from non-interactive cards.
- (b) Turn "How it works" into a left-aligned 3-step horizontal flow that reuses real UI fragments (upload dropzone, extracted-row, export button), not three more cards.
- (c) Merge "Who it's for" into Features or cut it. Four tiny cards add scroll without adding information.
- (d) Left-align one section header (Pricing or FAQ) to break the axis.

**P6. Stats band.** The values mix numbers with phrases ("Every field", "JSON + CSV"), so the mono display reads as filler (`landing-page.tsx:61-66`, `S/design/home1440-stats.png`).
- Fix: either use only real measurable values (median seconds to extract, formats, price), or drop the band and put a single proof line under the preview.

**P7. "Let's talk" is set as a price.** `font-mono text-3xl` (`landing-page.tsx:193`) makes it look like a number field.
- Fix: render a non-numeric `price` in `font-sans text-2xl font-semibold`, and leave `cadence` empty without its stray `gap`.

**P8. The legal page container doesn't match its footer.** The header and article are `max-w-3xl` (`legal-page.tsx:22,35`) but `SiteFooter` is `max-w-6xl`, so the footer shifts wider than the page (`S/public/privacy@1440.png`).
- Fix: pass a `className`/`width` prop to `SiteFooter`, or use a slimmer one-row footer on legal pages.

**P9. Tech-stack strings in user-facing chrome.** "Next.js · Better Auth · Effect · AI SDK · Drizzle" appears in `site-footer.tsx:64` and `auth-layout.tsx:63-65`. Customers don't buy the stack; this reads as a starter template.
- Fix: remove it. In the auth aside, replace it with "© receiptOCR · Privacy · Terms", or with nothing.

**P10. Reset password gives no success signal.** `reset-password-form.tsx:50` silently pushes to `/sign-in`.
- Fix: push `/sign-in?reset=1` and show a `role="status"` emerald notice in `CredentialsForm`: "Password updated. Sign in with your new password."

## Polish: accessibility

| # | Issue | WCAG | Evidence | Fix |
|---|---|---|---|---|
| A1 | Tap targets under 44px on mobile: header CTA 111×32, menu 36×36, auth-footer links 16px tall, footer links 18px tall, primary buttons 40px | 2.5.5 (AAA; 2.5.8 AA is 24px) | probe at 390 | `button.tsx:22-23`: `sm` → `h-9 sm:h-8`, `default` → `h-11 sm:h-10`; menu button `size-11`; footer/auth links `inline-flex min-h-11 items-center` (or `py-2.5`) |
| A2 | Mobile auth pages have no `<h1>` (the aside holding it is `hidden lg:flex`) | 1.3.1 / 2.4.6 | `auth-layout.tsx:33`, probe `h1: []` | Make the card title the `<h1>` (`credentials-form.tsx:106` etc.) and demote the aside heading to a `<p>`/`h2` |
| A3 | Landing/legal `<header>`/`<footer>` sit inside `<main>`, so the page has no banner or contentinfo landmarks | 1.3.1 | `landing-page.tsx:212,217,472`; `legal-page.tsx:20-60` | Wrap in a fragment: `<SiteHeader/><main>…</main><SiteFooter/>` |
| A4 | Inconsistent focus: FAQ `summary` shows the browser-blue outline (`S/design/faq-focus.png`), nav links rely on a faint bubble only (`outline-none`), footer/auth links use the UA default | 2.4.7 | `accordion.tsx:21`, `site-header.tsx:77`, `site-footer.tsx:51` | One token: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md` on summary, nav and footer links |
| A5 | The support widget auto-opens after 60 s and moves focus into the email field (pops the keyboard on phones, interrupts screen-reader reading) | 3.2.1 / 2.2.4 | `support-widget.tsx:24,73,80` | No auto-open; at most a non-modal pulse on the FAB. Move focus only when the user opens it |
| A6 | Motion is not reduced: `glow-orb`, `floating-receipt`, `animate-fade-up`, `scroll-behavior: smooth`, and button/card hover translate all ignore `prefers-reduced-motion` | 2.3.3 (AAA), guideline | `globals.css:14-20`, `styles.css:46-48,89-91` | Wrap them in `@media (prefers-reduced-motion: no-preference)` like `.scan-line` already is; add `motion-safe:` to the `hover:-translate-y-*` classes |
| A7 | Heading order on home goes H1 → H3 ("Extracted data" in the preview) → H2 | 1.3.1 | `product-preview.tsx:58` | Use a `<p className="text-sm font-medium">`, since it's decorative UI |
| A8 | The mobile menu doesn't trap focus or dim the page, and the open sheet covers the H1 with no scrim | guideline | `S/design/home390-menu.png`, `site-header.tsx:120` | Add `fixed inset-0 bg-background/60 backdrop-blur-sm` behind it, close on outside tap, and return focus to the toggle on close |

Contrast (computed): muted text `#9a9aa3` is 7.09:1 on bg and 6.59:1 on card. Primary on bg is 10.3:1, and button text on primary is 9.98:1. The error text `red-400` is 6.06:1. The auth stack line `muted/70` is 3.95:1, which fails body text (P9 removes it). Input border is 1.24:1 and fails (B3). All other text passes.

## Ideas

- I1. A visible "Continue with Google / GitHub" in shots would raise perceived polish. It is env-gated locally, so confirm the preview environment shows it, and keep the provider buttons `variant="outline"` `h-11`.
- I2. Make the hero product preview the hero itself on desktop: put it next to the H1 in a 5/7 split, and drop the three floating decorative receipts (`hero-floating-receipts.tsx`), which compete with the real preview and duplicate it.
- I3. One real number in the hero footnote (for example "≈4 s median extraction"), shown in mono, is more premium than an extra slogan. This is subject to the product review's evidence bar.
- I4. Light theme: `colorScheme: "dark"` is forced (`layout.tsx`). That is fine for v1, but the `:root` tokens would need a light set before marketing to accountants on bright office screens.

## What works

- A disciplined palette: a single accent, with mono reserved for data. Text tokens pass AA with room to spare.
- The product preview with the receipt on one side and the extracted fields on the other is honest and on-brief.
- The auth error state is clear, has `role="alert"`, and says what happened (`S/design/signin-error.png`). The forgot-password copy avoids account enumeration without sounding robotic.
- The FAQ uses native `<details>`, which is keyboard and screen-reader friendly, and there is no horizontal overflow at 390 on any page.

## Priority order

B1 → B2 → B3/B4 → B5 → B6 → P1 → P2/P3 → A1–A3 → P4–P10 → rest.
