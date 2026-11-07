# Brand assets

Logo: **Scan line**, a receipt crossed by a bar that overshoots both edges (keep the overshoot in every
drawing, or it reads as a generic receipt). Colours: tile `#34d399` with glyph `#07110d` on dark; tile `#047857`
with a white glyph on light. Wordmark: `Receipt` + emerald `OCR`, monospace.

## Masters (edit these)

| File                                         | What                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mark-full.svg`, `mark-small.svg`            | Glyph only, `currentColor`; full drawing, and the heavier one for 24px and under                                                                                  |
| `app-icon.svg`, `app-icon-light.svg`         | Rounded tile + full mark, dark and light                                                                                                                          |
| `app-icon-small.svg`                         | Tile + small mark, for 16-48px (favicon)                                                                                                                          |
| `app-icon-maskable.svg`                      | Square, mark at 70% of the box, so the bar stays inside the 80% safe circle                                                                                       |
| `app-icon-monochrome.svg`                    | Black glyph on transparent, for Android themed icons                                                                                                              |
| `lockup-dark.svg`, `-light.svg`, `-mono.svg` | Tile + wordmark; mono uses `currentColor`. Text is live, in Geist Mono with a monospace fallback, so use them where that font is available, not as raster sources |

## Generated outputs (`bun run brand:assets`, then commit)

Add `--sheet <file.png>` to also write a contact sheet. Other scripts render from the masters with
`renderMaster(name, size)` exported from `scripts/brand-assets.ts` (for example iOS splash images from `app-icon`).

| File (under `apps/web`)                  | Size     | Used for                                                   |
| ---------------------------------------- | -------- | ---------------------------------------------------------- |
| `app/icon.svg`                           | vector   | Browser tab (Next), offline page, structured-data logo     |
| `app/favicon.ico`                        | 16/32/48 | Browser fallback, `/favicon.ico` requests                  |
| `public/icons/favicon-32.png`, `-48.png` | 32, 48   | Google Search favicon (multiple of 48), legacy PNG favicon |
| `app/apple-icon.png`                     | 180      | iOS home screen (opaque; iOS rounds the corners)           |
| `public/icons/icon-192.png`, `-512.png`  | 192, 512 | PWA manifest, Android install                              |
| `public/icons/icon-maskable-512.png`     | 512      | PWA manifest, adaptive icon                                |
| `public/icons/icon-monochrome-512.png`   | 512      | PWA manifest, Android themed icon                          |
| `public/brand/google-oauth-120.png`      | 120      | Google OAuth consent screen logo (square, under 1 MB)      |
| `public/brand/google-512.png`            | 512      | Google brand/Search square logo                            |
| `public/brand/play-store-512.png`        | 512      | Google Play-style 512 (full bleed, no rounding)            |
| `public/brand/avatar-400.png`            | 400      | Social avatars (full bleed, survives a circle crop)        |
| `public/brand/email-logo.png`            | 128      | Email header, shown at 64px (`/brand/email-logo.png`)      |
| `app/opengraph-image.tsx`                | 1200x630 | Social share card (mark + wordmark in `lib/og-image.tsx`)  |
