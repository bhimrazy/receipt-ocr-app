# Photo viewer review, 2026-11-09

Design, UX and product review of the full-size view in the capture review sheet
(`apps/web/components/capture/full-size-view.tsx`, mounted in the stage of `review-sheet.tsx`). Read-only review of
`main` at 8d7adbd, prompted by the owner's desktop feedback on a long 909 × 2576 receipt: the image sits stuck to the
left of a large empty area, it can't be dragged, there's no zoom, and it's hard to get around. A pan/zoom viewer is
being built in parallel; this review sets the decisions it follows.

Evidence: the code, and the 1440 and 390 screenshots from the last fix round (`fix-full-size-{actual,whole}-*`, a
1000 × 2030 test receipt). No new screenshots were taken; nothing ran on a real phone.

## 1. Critique of today's view

What works:

- **The honesty is right.** The view shows the encoded file, not the edit preview, and the caption is read from that
  file. "This is exactly what the model gets" is the product's best answer to "will it read my receipt?".
- **The bar never covers the image**, and the caption sits in its own strip, so nothing jumps.
- **Desktop keeps the size picker beside the image.** Switching Standard to Sharpest and seeing the result at once is
  the most useful loop on this screen.

What doesn't:

| Finding | Severity | Why |
| --- | --- | --- |
| At Actual pixels the image is pinned top-left with a grey band on the right (1440: 1000 px image in a 1088 px area; 390: a 1000 px image is 333 CSS px at DPR 3). | High | Looks broken. Content narrower than the viewport must be centred. |
| "Actual pixels" means one image pixel per *device* pixel. On a DPR-3 phone that is smaller than Fit width, so "zooming in" can make text smaller. On a DPR-1 desktop it is a fixed 100% with no way closer. | High | It's technically honest but gives the wrong result for the job: a person checking small print needs magnification, not device-pixel parity. |
| No zoom between or beyond the two modes. No pinch handled by the app (the browser's page zoom takes over on touch). | High | The owner's main complaint. Small print on a long receipt can't be enlarged. |
| Opens at Actual pixels, centred in the middle of the image (`fullSizeMode` default `"actual"`). | Medium | Opens on "Item 06" rather than the header or total. The first view says nothing about the whole receipt. |
| Two-mode segmented toggle plus Done plus a mode-dependent hint in the side panel. | Medium | Three places to read before acting. The hint ("One pixel of the upload per screen pixel") explains the implementation, not what to do. |
| On phones the viewer lives in the stage, which is `clamp(12rem, 40svh, 34rem)` tall (about 260 CSS px in the 390 shot). | Medium | A long receipt in a 260 px window is a keyhole. Every other phone photo viewer goes full screen. |
| Toggle buttons are `min-h-9` (36 px); Done is `size="sm"`. | Medium | Below the 44 px tap target in `docs/product-standards.md`. |
| The drag-to-pan only works with a mouse and only at Actual pixels; the cursor gives no hint at Whole receipt. | Low | Discoverability. |

## 2. The job of this view

The job is **"is this photo readable enough to upload?"**, not "inspect pixels". The user wants two answers fast: is
the whole receipt in the frame (corners, header, total), and is the small print sharp. So the view should open on
the whole receipt (or as much of it as stays legible) and offer one obvious gesture to look closer at a spot. Pixel
parity is a power-user detail; the caption already states the exact size and bytes, which is the honest part.

## 3. Recommended design: decisions

Each decision has a recommended default and one alternative. The owner picks; the builder follows the default unless
told otherwise.

### D1. Zoom model

- **Recommended:** free zoom from Fit to 400%, where **100% means one image pixel per CSS pixel** (what "100%" means in
  every browser and image viewer). Drop the "Whole receipt | Actual pixels" toggle entirely. Device-pixel parity is
  no longer a named mode.
- Alternative: keep the toggle and map it to Fit / 1:1 (the proposal on the table). Rejected as default: two modes plus
  − % + is two ways to do one thing, and "Actual pixels" behaves differently per device (see the critique).

### D2. Controls

- **Recommended, all sizes:** a small **floating pill at the bottom centre** of the viewer: `−` · `43%` · `+`. The
  percentage is itself a button: at Fit it reads "Fit" and jumps to 100%; zoomed in, it shows the % and returns to
  Fit. That is the only Fit control. Done stays top-right. No other buttons.
- Gestures: drag to pan (mouse, pen and touch); pinch and trackpad pinch to zoom around the fingers; Ctrl/Cmd + wheel
  zooms around the pointer; plain wheel and two-finger scroll pan when zoomed. Desktop: **single click** toggles Fit ↔
  100% at the click point (Google Photos web, Medium), ignored if the pointer moved more than 4 px (it was a drag).
  Touch: **double-tap** toggles Fit ↔ 100% at the tap point (iOS Photos, Google Photos app); single tap does nothing.
- Cursors: `zoom-in` at Fit, `grab` / `grabbing` when zoomed, `zoom-out` is not used.
- Alternative: controls in the top bar next to Done. Simpler layout, but at 390 it competes with Done and puts the
  thumb target at the top; keep the bar for Done only.

### D3. Default zoom per device and receipt shape

- **Recommended:** open at **Fit** (whole image, centred) for ordinary receipts. For **long receipts (height ÷ width
  ≥ 2)**, open at **Fit width, capped at 100%, top-aligned**, so the header is readable at once and the user scrolls
  down. Same rule on phone and desktop; on desktop the 100% cap keeps a 909 px receipt at 909 px, centred
  horizontally, instead of upscaling it.
- Remember the zoom only while the view is open; reopening starts from the default again (today it remembers the
  last mode for the session, which is how it reopened on Actual pixels).
- Alternative: always Fit. Consistent, but a 1:2.8 receipt at Fit on a phone is ~250 px wide and unreadable, so the
  first thing every user does is zoom.

### D4. Layout

- **Recommended:** **phone (below `md`): a true full-screen overlay** over the whole sheet (`bg-background`,
  safe-area insets respected), Done top-right, caption at the bottom, the pill above it. **Desktop: stay in the stage**
  (the area left of the side panel), filling it, with the image centred whenever it's smaller than the area. Keeping
  the side panel visible is worth it: changing the size and seeing the new file is the main desktop loop.
- Alternative: full-screen on desktop too (Google Photos web style). More room, but loses the size picker beside the
  image; only worth it if the owner sees the size loop as rare.

### D5. Caption and hints

- **Recommended:** keep the caption, shortened: **"Uploads as 1000 × 2030 px · 90 KB JPEG"** (numbers in `font-mono
  tabular-nums`, as today). Replace the three mode-dependent hints in the side panel with one line, shown once per
  session in the viewer itself and faded after first use: desktop **"Click to zoom. Drag to move."**, touch
  **"Double-tap or pinch to zoom."** The side panel's "Tap the preview to see exactly what uploads." stays.
- Alternative: keep "Uploads exactly this:"; it's slightly more emphatic about honesty but longer at 390.

### D6. Navigation aids on long receipts

- **Recommended: no minimap.** A receipt is one column; a slim vertical position indicator (overlay-style, like iOS
  scroll indicators, `bg-foreground/40`, shown while panning) plus the % readout is enough.
- Alternative: a minimap thumbnail with the viewport box. Useful for wide documents and maps, not worth the space and
  the extra focusable element here.

### D7. Bounds

- **Recommended:** centre on any axis where the image is smaller than the viewport; otherwise clamp so the image edge
  can't move past the viewport edge. Light rubber-band at the edges on touch, none with a mouse. Min zoom = Fit (or the
  long-receipt default if smaller); max 400%.
- Alternative: allow zooming out below Fit to 50% for "see it small". No user need for it.

### D8. Accessibility

- **Recommended:**
  - The viewport is a focusable `role="region"` labelled "Upload preview, 1000 × 2030 px". Keyboard when it has focus:
    `+`/`=` zoom in, `-` zoom out, `0` Fit, `1` 100%, arrows pan by 10% of the viewport (Shift: 50%), Home/End jump to
    top/bottom on long receipts. Escape is Done (it already maps to `back()`).
  - Focus moves to the viewport on open and back to the preview trigger on Done. Visible `focus-visible` ring, inset,
    as today.
  - Pill buttons labelled "Zoom out", "Zoom in", and the readout "Zoom 43%. Fit to screen" / "Fit. Zoom to 100%". A polite
    live region announces the zoom level after keyboard or button zoom (not on every pinch frame).
  - All targets at least 44 × 44 px, including Done and the pill segments; disable `−` at min and `+` at max with
    `aria-disabled`, not by removing them.
  - Zoom and Fit transitions ≤ 200 ms ease-out; instant under `prefers-reduced-motion`. Pinch and drag follow the
    finger with no easing at all.
  - `touch-action: none` on the viewport only, so the app's pinch never becomes browser page zoom, and page zoom still
    works elsewhere.
- Alternative: no keyboard shortcuts beyond arrows and Escape, relying on the pill. Cheaper, but desktop users expect
  `+`/`-`/`0`.

## 4. Familiar patterns

| Pattern | What it does | Take |
| --- | --- | --- |
| iOS Photos | Full screen, opens at Fit, double-tap zooms at the point, pinch, rubber-band edges, no visible zoom controls. | Phone gestures, full-screen overlay, rubber-band. |
| Google Photos web | Full screen, click to zoom at the point, drag to pan, zoom slider on hover. | Desktop click-to-zoom. |
| Adobe Scan / Microsoft Lens review | Page fills the screen, pinch to zoom, no controls; the task is "is the scan OK, keep it". | Confirms the job framing: Fit first, zoom on demand. |
| Figma hand tool | Space-drag, zoom % menu, Shift+0/1, minimap absent. | Shortcut set (`0`, `1`, `+`, `-`) and the % readout; not a persistent hand tool, which is a canvas-editing idea. |

Fit: iOS Photos on touch, Google Photos web on desktop, Figma's shortcuts and % readout. A separate "hand tool" mode
isn't needed: when there's nothing else to do with the pointer, drag already means pan.

## 5. Acceptance checks

The builder tests against these (Playwright where possible, at 1440 and 390, light and dark).

1. A 909 × 2576 receipt opens at 1440 centred horizontally in the stage at 100% (909 px wide), top-aligned, no grey
   band on one side only.
2. A 1000 × 1300 receipt opens at Fit, centred on both axes, at 1440 and 390.
3. The same long receipt at 390 opens full screen, fit to width, top-aligned; the header text is visible without
   interaction.
4. No "Whole receipt" or "Actual pixels" labels remain; the pill shows `−`, a readout, `+`.
5. Click (desktop) at a point zooms to 100% with that point under the pointer (±2 px); a second click returns to Fit. A
   drag of more than 4 px never toggles zoom.
6. Ctrl/Cmd + wheel zooms around the pointer; plain wheel pans when zoomed; trackpad pinch (`ctrlKey` wheel) zooms.
7. Touch: pinch zooms around the midpoint; double-tap toggles; one-finger drag pans; the browser page never zooms.
8. Panning can't push the image edge past the viewport edge; an axis smaller than the viewport stays centred.
9. Zoom is clamped to [default min, 400%]; `−` and `+` are `aria-disabled` at the limits.
10. Keyboard with the viewport focused: `+`, `-`, `0`, `1`, arrows, Shift+arrows, Home/End and Escape work as in D8;
    focus returns to the preview on Done.
11. Every interactive target (Done, `−`, readout, `+`) measures at least 44 × 44 px.
12. With `prefers-reduced-motion: reduce`, zoom changes apply without a transition.
13. The caption reads "Uploads as W × H px · N KB JPEG" from the encoded file and fits on one line at 390 with no
    horizontal page overflow.
14. Changing the size in the side panel at 1440 while the viewer is open swaps the image and keeps the zoom default
    rule (no stale size, no blank frame).
15. Contrast: pill icons and readout meet 3:1 (icons) and 4.5:1 (text) against the viewer background in both themes.
16. The screen-reader name of the viewport includes the pixel size, and zoom changes from keys or buttons are announced
    once.

## 6. Open for the owner

- D1: drop "Actual pixels" (recommended) or keep it as a named stop.
- D4: full screen on phones only (recommended) or on desktop too.
- D3: long-receipt default of fit-width-from-top (recommended) or always Fit.
