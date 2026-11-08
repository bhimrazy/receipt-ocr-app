# Light and System themes (2026-11-08)

Status: decided 2026-11-08 (every recommendation taken). PR 1, tokens and mechanism: #163 (merged). PR 2, toggle and System default: #166.

## Goal

Offer **System** (the default, follows `prefers-color-scheme`), **Light** and **Dark**. Dark stays exactly as it is
today. Light keeps the brand: emerald accent, monospace data, and a quieter glow/grid hero. No flash of the wrong
theme, and static pages stay static.

## Summary

| #   | Recommendation                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Light tokens use a deeper emerald, `#036c4d`. It reaches 6.45:1 on white and 4.81:1 on the `bg-primary/15` chips. Every text pair in the table passes AA.                                              |
| 2   | `:root` keeps today's dark tokens and `:root.light` overrides them. A ~400-byte blocking script in `<head>` sets the class from `localStorage` or the OS. No cookie, so the landing page stays static. |
| 3   | The rework is small: the app is already token-driven (a test enforces it). About 25 literal sites need changing, plus 3 new tokens: `--shadow-float`, `--scrim` and `--series-*`.                      |
| 4   | Ship all surfaces at once, in two PRs: (1) tokens and mechanism, Dark forced; (2) the toggle and the System default, after a screenshot sweep.                                                         |
| 5   | The toggle goes in Settings › Appearance (its main home), the account menu (app and admin) and the site footer. It doesn't go in the marketing header.                                                 |

## 1. Tokens

Computed with the WCAG 2.x relative-luminance formula. Tints such as `/10` are mixed over the surface named in the table.
The contrast test (section 5) should mix in oklab, as Tailwind's `color-mix` does; values move by about 0.1.

### Surfaces and text

| Token                                                | Dark (today)                | Light (proposed)     | Light check                                                       |
| ---------------------------------------------------- | --------------------------- | -------------------- | ----------------------------------------------------------------- |
| `--background`                                       | `#0a0a0b`                   | `#f7f7f8`            | page plane                                                        |
| `--card` / `--popover`                               | `#141416` / `#18181b`       | `#ffffff`            | lifted by `--border` + `--shadow-float`, not by tone alone        |
| `--secondary`                                        | `#18181c`                   | `#f1f1f3`            |                                                                   |
| `--muted`                                            | `#1c1c20`                   | `#efeff1`            |                                                                   |
| `--accent` (hover fill)                              | `#232328`                   | `#e8e8eb`            |                                                                   |
| `--sidebar`                                          | `#0f0f11`                   | `#f1f1f3`            |                                                                   |
| `--foreground` (+ `-card`, `-popover`, `-secondary`) | `#e4e4e7`                   | `#18181b`            | 16.55 on bg, 17.72 on card, 15.43 on muted                        |
| `--accent-foreground`                                | `#fafafa`                   | `#09090b`            | >17                                                               |
| `--muted-foreground`                                 | `#9a9aa3`                   | `#5f5f68`            | 5.90 bg, 6.32 card, 5.50 muted, 5.17 accent, 4.80 on `primary/15` |
| `--border` (decorative)                              | `#27272a`                   | `#e4e4e7`            | 1.19 bg / 1.27 card: card edges only; it carries no meaning       |
| `--input` (meaningful)                               | `#6b6b74`                   | `#8a8a93`            | 3.42 card, 3.20 bg (WCAG 1.4.11 ≥ 3)                              |
| `--hairline` (glass edge)                            | `rgb(255 255 255 / .1)`     | `rgb(24 24 27 / .1)` | decorative                                                        |
| `--wash`, `--wash-subtle`                            | derived from `--foreground` | unchanged formula    | flips automatically                                               |

### Accent, status and focus

| Token                          | Dark                           | Light                 | Light check                                                                  |
| ------------------------------ | ------------------------------ | --------------------- | ---------------------------------------------------------------------------- |
| `--primary`                    | `#34d399`                      | **`#036c4d`**         | text: 6.02 bg, 6.45 card, 5.20 on `/10`, 4.81 on `/15` (12 chips use `/15`)  |
| `--primary-foreground`         | `#07110d`                      | `#ffffff`             | 6.45 on primary; `/90` hover stays > 5.5                                     |
| `--ring`                       | `#34d399`                      | `#036c4d`             | 6.02 bg, 6.45 card (≥ 3)                                                     |
| `--success` / `-fg`            | `#34d399` / `#07110d`          | `#036c4d` / `#ffffff` | same as primary; stays a separate token                                      |
| `--warning` / `-fg`            | `#fbbf24` / `#1a1204`          | `#a14a07` / `#ffffff` | 6.00 card, 5.61 bg, 4.87 on `/10`, 5.59 on `/5` (receipt low-confidence row) |
| `--destructive` / `-fg`        | `#f87171` / `#1a0606`          | `#b91c1c` / `#ffffff` | 6.47 card, 6.04 bg, 5.45 on `/10`, 4.59 on `/20`                             |
| `--info` / `-fg`               | `#7dd3fc` / `#04131c`          | `#0369a1` / `#ffffff` | 5.93 card                                                                    |
| `--cta` / `-hover` / `-fg`     | `#047857` / `#065f46` / `#fff` | unchanged             | 5.48 / 7.68; already theme-neutral                                           |
| `--brand-teal`, `--brand-cyan` | `#2dd4bf`, `#22d3ee`           | `#0f766e`, `#0e7490`  | 5.47 / 5.36 on card (gradient text stays ≥ 4.5 end to end)                   |
| `::selection`                  | primary 34%                    | same formula          | fg on it 10.67                                                               |

The brand's light-context tile (`#047857`, brand decisions 2026-11-07) is unchanged. It stays as `--cta` and in the
brand assets. In light, the in-UI mark uses `--primary`, which is one step deeper.

Rejected: `#047857` (emerald-700) as light primary. It reaches 5.48 on white but only **4.16** on the `bg-primary/15` chips.
`#a16207`/`#b45309` for warning drop to 4.39 on `bg-warning/10`.

### Receipt group colours (≥ 3:1 on card, as today)

| Group  | Dark      | Light     | Light on `#fff` |
| ------ | --------- | --------- | --------------- |
| green  | `#4ade80` | `#16a34a` | 3.30            |
| teal   | `#2dd4bf` | `#0d9488` | 3.74            |
| blue   | `#60a5fa` | `#2563eb` | 5.17            |
| violet | `#a78bfa` | `#7c3aed` | 5.70            |
| pink   | `#f472b6` | `#db2777` | 4.60            |
| red    | `#f87171` | `#dc2626` | 4.83            |
| orange | `#fb923c` | `#ea580c` | 3.56            |
| yellow | `#facc15` | `#a16207` | 4.92            |

### Charts

Dashboard charts already use `var(--primary)` and `var(--muted-foreground)`, so they switch with no change. Admin
ops charts hard-code the dark steps of the reference palette (`components/admin/ops/palette.ts`). Move these to
`--series-1…8`, `--series-other` and `--outcome-*` tokens and use the reference **light** steps:

| Slot  | 1 blue    | 2 orange  | 3 aqua    | 4 yellow  | 5 magenta | 6 green   | 7 violet  | 8 red     | other     |
| ----- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- |
| Light | `#2a78d6` | `#eb6834` | `#1baf7a` | `#eda100` | `#e87ba4` | `#008300` | `#6250d6` | `#e34948` | `#8a8a93` |

The dataviz validator, run in light mode on `#ffffff`, passes all eight colours. The worst adjacent colour-blind pair is ΔE 9.1 and the
worst normal-vision pair is ΔE 19.6. Aqua (2.82), yellow (2.17) and magenta (2.69) fall below 3:1 against the surface, so the relief rule
applies: the ops charts already have a legend, labels and a table. Outcome colours in light: ok `#1baf7a`, in flight
`#2a78d6`, failed `#e34948`. `chart.tsx`'s `THEMES` selector map becomes `{ light: ":root.light", dark: ":root:not(.light)" }`
for any config that uses `theme`. No chart uses it today.

### Effects and elevation in light

| Effect                                        | Dark today                                | Light                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.hero-aurora`                                | opacity .9, blurred primary/teal/cyan     | Keep it at opacity **.45**: it reads as a pale mint haze (previewed)                                                                                                               |
| `.glow-orb` (`bg-primary/5`, `/15`)           | soft glow                                 | Keep; the closing-CTA orb drops to `/10`                                                                                                                                           |
| `.receipt-grid` + `.grid-mask`                | `--border` lines                          | Keep: `#e4e4e7` lines behind the mask make a faint graph-paper look                                                                                                                |
| `.card-sheen` (white 8% top edge)             | glass highlight                           | **Drop**: invisible on white, so elevation comes from the shadow                                                                                                                   |
| `.text-gradient`                              | primary → teal/cyan mixed with white      | No white mix: `primary → brand-teal → brand-cyan` (≥ 5.36)                                                                                                                         |
| Primary glows (`shadow-[0_0_24px_…primary…]`) | brand mark, nav FAB, hero dot             | Keep: emerald on light reads as a soft halo                                                                                                                                        |
| `.scan-line`                                  | primary sweep                             | Keep                                                                                                                                                                               |
| `shadow-2xl shadow-black/40–50`               | floating cards, header, panels, auth card | New token **`--shadow-float`**. Dark: `0 25px 50px -12px rgb(0 0 0 / .5)`; light: `0 16px 40px -16px rgb(24 24 27 / .18)`. Black at 40% looks heavy on light (seen in the preview) |
| Overlay scrim `bg-black/70`                   | dialogs, alert dialogs, drawer            | New token **`--scrim`**. Dark: `rgb(0 0 0 / .7)`; light: `rgb(9 9 11 / .4)`                                                                                                        |

## 2. Mechanism

| Concern                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the theme lives                     | One class on `<html>`: `.light` or none. `:root` keeps today's dark tokens, so no JS means Dark, as today. `:root.light { …light tokens…; color-scheme: light }`. Any element with `.dark` restores the dark tokens in its subtree (camera, crop).                                                                                                                                                                                              |
| `@custom-variant`                         | `@custom-variant dark (&:where(:root:not(.light), :root:not(.light) *, .dark, .dark *));` and `@custom-variant light (&:where(.light, .light *));` for the few effect tweaks. The `dark:` variants from the component registry keep working.                                                                                                                                                                                                    |
| Rejected: `light-dark()` tokens           | Neat (System works with no JS), but it needs Safari 17.5+. Tailwind v4 already serves Safari 16.4+, so iOS 16.4–17.4 would get invalid colours.                                                                                                                                                                                                                                                                                                 |
| Preference storage                        | `localStorage["theme"] = "light" \| "dark"`; a missing key means System. **No cookie.** Reading a cookie in the root layout would make every page dynamic, including the static landing page. A user-requested preference counts as strictly necessary storage, so it needs no consent, but it must be listed on `/cookies`.                                                                                                                    |
| No flash                                  | A blocking inline `<script>` as the first child of `<head>` in `app/layout.tsx` runs before the first paint. It's a plain `<script dangerouslySetInnerHTML>`, not `next/script`: App Router may hand inline `beforeInteractive` scripts to its runtime instead of running them while parsing. The no-flash e2e test (section 5) checks this either way. `<html>` already has `suppressHydrationWarning`.                                        |
| Script (about 400 B)                      | Read `theme`. `light = t === "light" \|\| (t !== "dark" && matchMedia("(prefers-color-scheme: light)").matches)`. Toggle `.light` and set `style.colorScheme`. If `t` is set, write that theme's colour into every `meta[name=theme-color]`. Everything sits in `try/catch`, which falls back to Dark.                                                                                                                                          |
| Live changes                              | A small client `ThemeProvider` (no new dependency; `next-themes` doesn't earn its place for 40 lines). It listens to `matchMedia` changes when on System and to the `storage` event (other tabs). While switching it adds `[data-theme-switching]`, which sets `transition: none` for one frame.                                                                                                                                                |
| CSP                                       | Today the policy is report-only with `script-src 'unsafe-inline'`, so the script runs as is. When `script-src` is enforced, allow it by **hash** (`'sha256-…'` computed in `lib/csp.ts` from the same exported string, with a unit test), not by nonce, because a nonce forces dynamic rendering. Don't add the hash before that change. A hash makes browsers ignore `'unsafe-inline'`, and every Next bootstrap script would start reporting. |
| `color-scheme`                            | The `viewport.colorScheme` value becomes `"dark light"`. The CSS `color-scheme` on `:root` and `:root.light` decides the rest (scrollbars, form controls).                                                                                                                                                                                                                                                                                      |
| `theme-color`                             | `viewport.themeColor` becomes `[{ media: "(prefers-color-scheme: light)", color: "#f7f7f8" }, { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" }]`. The script overrides both tags when the user has chosen a theme.                                                                                                                                                                                                                   |
| iOS                                       | `appleWebApp.statusBarStyle` changes from `"black"` to `"default"`, so the bar follows the page. Check this on a device. Splash images: add a light set of 10 PNGs (`lib/ios-splash.ts` already has `SplashTheme`), each with a `prefers-color-scheme` media query. Splash images follow the OS, not an explicit choice; that's acceptable.                                                                                                     |
| PWA manifest                              | It can't vary by scheme. `background_color`/`theme_color` stay `#0a0a0b` (dark-first brand; it's only the Android launch splash).                                                                                                                                                                                                                                                                                                               |
| Pinned dark                               | Camera sheet and crop editor (photo context, canvas uses `#111`/`#34d399`), OG image (Satori), app icons.                                                                                                                                                                                                                                                                                                                                       |
| `global-error.tsx`, `public/offline.html` | Both render without the root layout. Add a `@media (prefers-color-scheme: light)` block to their inline styles. `offline.html` can also read `localStorage.theme` (same origin).                                                                                                                                                                                                                                                                |
| Emails                                    | Out of scope. `packages/email` keeps its dark theme. Client dark-mode inversion is a separate topic.                                                                                                                                                                                                                                                                                                                                            |

## 3. Toggle

A three-way radio group: **System · Light · Dark**, with lucide `Monitor`, `Sun` and `Moon` icons. Each segment is at least 44×44 px
on phones. It has `role="radiogroup"`, every segment has an `aria-label`, arrow keys move between segments, and the existing focus ring applies. The same
`ThemeToggle` component, in `components/theme-toggle.tsx`, is used everywhere.

| Place                                                                                        | What                                                                         | Why                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Settings › Appearance** (new section above Receipt scanning)                               | Labelled segmented control with the hint "Match your device, or choose one." | The main home: findable and described                                                                                          |
| **Account menu**: desktop dropdown and phone drawer (app **and admin**, both use `UserMenu`) | A "Theme" row with the icon-only control inline, above Cookie settings       | One tap from anywhere; admin gets it for free                                                                                  |
| **Site footer** (landing, pricing, legal, use-case pages; auth footer row too)               | Icon-only control on the © row                                               | Visitors can choose before signing up. **Not the header**: its CTAs drive conversion, and the hero already has enough going on |

```
Settings › Appearance                     Account menu (desktop)        Site footer, bottom row
┌──────────────────────────────────────┐  ┌─────────────────────────┐   ┌──────────────────────────────────────┐
│ Appearance                           │  │ Ada Example             │   │ © 2026 ReceiptOCR   [▣][☀][☾]        │
│ Match your device, or choose one.    │  │ ada@example.com         │   │                  A product by …  GitHub│
│ ┌──────────┬──────────┬──────────┐   │  │─────────────────────────│   └──────────────────────────────────────┘
│ │▣ System ●│ ☀ Light  │ ☾ Dark   │   │  │ Settings                │
│ └──────────┴──────────┴──────────┘   │  │ Admin                   │   ▣ System  ☀ Light  ☾ Dark
└──────────────────────────────────────┘  │ Theme      [▣][☀][☾]    │   (● = selected)
                                          │ Cookie settings         │
                                          │ Sign out                │
                                          └─────────────────────────┘
```

## 4. Inventory

The `design-tokens.test.ts` guard already blocks hex, palette and white/black utilities in `app/` and `components/`.
What's left is below. Effort: S < 1 h, M ≤ half a day, L ≥ 1 day.

| Group                | Files                                                                                                                                                                                                                                                                                                                        | Change                                                                                           | Effort |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------ |
| Tokens and mechanism | `packages/ui/src/styles.css`, `app/layout.tsx`, new `components/theme-provider.tsx`, `components/theme-toggle.tsx`, `lib/theme-script.ts`                                                                                                                                                                                    | `:root.light` block, variants, `--shadow-float`/`--scrim`/`--series-*`, script, provider, toggle | L      |
| Effects              | `app/globals.css`                                                                                                                                                                                                                                                                                                            | `light:` overrides for aurora, sheen and gradient                                                | S      |
| Heavy shadows (7)    | `product-preview`, `site-header-bar` ×2, `support-widget-client`, `hero-floating-receipts`, `support-panel`, `auth/auth-field`                                                                                                                                                                                               | `shadow-black/40–50` → `shadow-float`; then add `shadow-black` to the token test                 | S      |
| Overlay scrims (3)   | `packages/ui` `dialog`, `alert-dialog`, `drawer`                                                                                                                                                                                                                                                                             | `bg-black/70` → `bg-scrim`                                                                       | S      |
| Chart palette        | `components/admin/ops/palette.ts`, `ops/charts.tsx`, `packages/ui` `chart.tsx`                                                                                                                                                                                                                                               | Hex → `var(--series-n)`; `THEMES` selectors                                                      | M      |
| Pinned dark          | `capture/camera-sheet.tsx`, `capture/crop-editor.tsx`                                                                                                                                                                                                                                                                        | Add `.dark` on the sheet root; the canvas literals then stay correct                             | S      |
| Head and PWA         | `app/layout.tsx` (themeColor, colorScheme, statusBarStyle), `lib/ios-splash.ts`, `scripts/` splash generator, `public/splash/light-*`                                                                                                                                                                                        | Per-scheme metadata, 10 light splash images                                                      | M      |
| Outside the layout   | `app/global-error.tsx` (9 inline hexes), `public/offline.html` (7 hexes)                                                                                                                                                                                                                                                     | Media-query light block                                                                          | S      |
| Copy and legal       | `app/cookies/page.tsx`                                                                                                                                                                                                                                                                                                       | List the `theme` localStorage key                                                                | S      |
| Unchanged (and why)  | `lib/og-image.tsx` (stays dark), Google/GitHub icons (brand fills / `currentColor`), `security/qr-code.tsx` (black on white is required), `lib/upload-prep.ts` (`#fff` is image data), `brand/*.svg` (light lockup already exists), use-case art on `feat/seo-use-case-pages` (all `fill-primary`/`muted-foreground` tokens) | none                                                                                             | —      |

**Phasing.** Don't split by surface. Scoping `.light` to public routes means the theme flips at sign-in, and the
primitives are shared anyway. Split by exposure instead:

1. **PR 1, mechanism and tokens.** The script honours only an explicit `localStorage.theme = "light"`, and there's no UI.
   Production looks unchanged; QA and the screenshot sweep use the key.
2. **PR 2, exposure.** Toggle in three places, System becomes the default, light splash images, `/cookies` entry.

## 5. Testing

| Check                 | How                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token contrast (unit) | `packages/ui/src/theme-contrast.test.ts` parses both token blocks from `styles.css` and asserts the pair list from section 1: text ≥ 4.5, UI/focus ≥ 3, groups ≥ 3 on card, tints mixed in oklab. Pure function, no browser, about 80 lines.                                                                                                                                                                                 |
| No flash (e2e)        | An `addInitScript` MutationObserver records whether `<html>` had the right class when `<body>` was inserted. Run it for `colorScheme: "light"` with no key, `"dark"` with the key set to light, and the reverse.                                                                                                                                                                                                             |
| Theme e2e             | Toggle in the footer, menu and Settings: the class changes, the choice persists after reload, a second tab follows (`storage`), and System follows `page.emulateMedia({ colorScheme })`. Keyboard only: Tab to the group, arrow keys, visible focus ring.                                                                                                                                                                    |
| Screenshot sweep      | Add `--theme light\|dark` to `scripts/screenshot.mjs`, which sets `localStorage` before navigating. Pages: `/`, `/pricing`, `/use-cases/*`, `/sign-in`, `/sign-up`, `/app`, `/app/upload`, a receipt result with a needs-review field, `/app/history`, `/app/groups`, `/app/settings` (+ billing, security), `/admin`, `/admin/operations`, at 1440 and 390, both themes. Each page must have no horizontal overflow at 390. |
| Visual checklist      | Card edges visible on `--background`; the low-confidence row (`bg-warning/5` + inset bar) still stands out; status badges are told apart by icon and label, not colour alone; dialogs and drawers dim the page but not to black; chart gridlines stay faint; focus ring visible on white and on `--muted`; QR stays black on white; camera stays dark; the iOS status bar matches in standalone.                             |
| Gates                 | `bun run lint`, `typecheck`, `test`, `scripts/test.sh` (e2e on the compose stack).                                                                                                                                                                                                                                                                                                                                           |

Preview: proposed light tokens injected into today's `/`, `/sign-in` and `/pricing` (1440 and 390). No horizontal
overflow. Shadows were the only clear defect, which led to `--shadow-float`.

## 6. Owner questions

| #   | Question                                                                                                              | Recommendation                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Should the default be System for everyone, existing users included? Light-OS users will see light the day PR 2 ships. | **Yes, System.** That's what "follow my device" means. The dark-first brand stays in the OG image, the PWA splash and dark-OS users. |
| 2   | Should the theme sync across devices (store it on the user)?                                                          | **Not now.** Use localStorage per device. Add a `user.theme` column later if people ask.                                             |
| 3   | Toggle in the marketing header too?                                                                                   | **No.** Footer only; keep the header for the CTAs.                                                                                   |
| 4   | Light iOS splash set (10 more PNGs, about 0.5 MB in `public/`)?                                                       | **Yes.** Without it, light-OS iPhone users get a dark flash at launch.                                                               |
| 5   | Should emails get a light variant?                                                                                    | **No, out of scope.** Revisit with an email dark-mode audit.                                                                         |
