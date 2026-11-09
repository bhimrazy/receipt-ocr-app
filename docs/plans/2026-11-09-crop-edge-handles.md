# Crop editor edge handles, and a steady review sheet (2026-11-09)

Status: approved 2026-11-09. The owner took the recommended default (a) in all 17 decisions; see the end.

## Goal

In "Adjust corners", the reviewer can hold the middle of a side and drag it to move that whole side (both its corners)
at once, and the free-hand adjustment feels better overall, without breaking what works today: four corner handles,
the loupe, arrow keys (Shift for bigger steps), Reset to detected and Full image.

The second part (from the owner, same day): nothing in the review sheet (Adjust corners and Preview) should flicker or
shift when a value is calculated or a choice changes. Example from the owner: switching the upload size between
"Smaller" and "Recommended" moves the size line a little.

Out of scope: pinch-zoom on the stage, undo history, better detection, and any change to how the crop is rendered or
uploaded (`render.ts`, `prepareFile`).

## Today, from the code

- `CropEditor` (`apps/web/components/capture/crop-editor.tsx`) draws the rotated photo once per `bitmap`/`rotation`
  into a canvas, then an SVG overlay (dimmed outside, emerald `stroke-primary` outline) and four 44 px round `<button>`s
  at the corners. Each button captures its pointer and calls `moveCorner(edit, i, pointFrom(event))` on every move: the
  corner jumps to the finger's absolute position.
- `moveCorner` (`lib/capture/edit-state.ts`) clamps to 0..1 and refuses (returns the same state) any move that leaves
  two corners closer than `MIN_GAP` (0.04) or makes the quad non-convex. A refused move freezes the corner at the last
  accepted position until the finger comes back. The 45–135 degree angle limits live only in `detect-quad.ts`; manual
  corner drags do not apply them.
- The loupe is a 104 px canvas, 2.8x, drawn once per animation frame from the canvas already on screen (`clipLoupe`),
  placed 40 px above the finger, or to the side near the top.
- The stage is pinned dark (`.dark` on its root) in both themes, as the light-theme spec decided, so the canvas
  literals `#111` and `#34d399` stay right. Edge handles therefore look the same in the light and dark themes; only the
  side panel around the stage follows the theme.
- Coordinates are normalised to the shown (rotated) image, which is usually not square. Any "perpendicular" or "length"
  has to be measured in pixel proportions (x scaled by width / height), not in raw normalised units.
- Visible hint under the controls: "Drag a corner to the edge of the receipt, or select one and use the arrow keys."
  The screen-reader hint on each corner: "Drag a corner to the edge of the receipt, or use the arrow keys. Hold Shift
  for bigger steps."

## Part 1: edge handles

### What an edge drag does

Edge `i` runs from corner `i` to corner `(i + 1) % 4`: 0 Top, 1 Right, 2 Bottom, 3 Left, in the shown frame (so after
a turn, "Top" is still the visual top).

Three candidate behaviours:

| Option                                    | What moves                                                                                                                              | Keeps                                                                  | Problem                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Slide along the neighbouring sides** | The edge moves parallel to itself by the finger's movement across it; each of its corners slides along the line to its other neighbour. | The edge's direction, both neighbouring sides' lines, all four angles. | The handle drifts a little along the edge when the neighbouring sides are not parallel (it stays at the midpoint, which moves).                     |
| B. Translate along the normal             | Both corners move by the same vector, perpendicular to the edge.                                                                        | The edge's direction and length.                                       | The neighbouring sides tilt: if detection got the left and right sides right and only the top wrong, dragging the top un-aligns the sides.          |
| C. Follow the finger freely               | Both corners move by the full finger delta, including along the edge.                                                                   | The edge's direction and length.                                       | The sideways part of a finger movement is almost never intended; it slides the edge off the paper and tilts both neighbours. Feels loose, not free. |

**Recommendation: A.** The reason someone grabs a side is "this side is in the wrong place; the others are right". A
keeps the other three sides exactly where they are and only changes where the dragged side cuts them, which is what a
receipt in perspective needs: drag the top down and the top corners run down the receipt's own left and right edges.
For a rectangle (the full frame, or a straight-on photo) A and B are the same, so in the common case nobody can tell
them apart.

A also has a property that makes it safe: the interior angle at every corner is unchanged by the move (each angle is
formed by two lines that do not change direction). So an edge drag can never fold the quad, never makes it
non-convex, and never moves any angle outside 45–135 degrees if it started inside. The only limits it can hit are the
image border and corners getting too close.

Scanner apps (Microsoft Lens, Adobe Scan, Apple's document scanner in Notes) all offer mid-side handles that move one
side while keeping it straight; that is the convention we follow. I have not verified frame by frame whether each one
uses A or B, so the implementer should screen-record one of them on a skewed page before building, as a five-minute
check. It does not change the recommendation, which stands on the argument above.

Only the finger's movement across the edge counts: the drag delta is projected onto the edge's outward normal (in pixel
proportions). Moving the finger along the edge does nothing.

### Limits: clamping and refused moves

- **Image border.** Each moved corner travels on a known line, so the allowed range of the move distance `d` is an
  interval found directly: for each moved corner and each of x, y, solve `0 <= p + d * u <= 1`. Clamp `d` to that
  interval. The edge stops when its first corner reaches the border, still parallel. Clamping each coordinate
  separately (as `moveCorner` does) would bend the edge, so it is not used here.
- **Too close or collapsed.** Moving inward shrinks the neighbouring sides linearly until the edge meets the opposite
  corners (or the edge itself shrinks to nothing, when the neighbours converge). The valid range of `d` is one interval
  containing 0, so when the requested `d` breaks `MIN_GAP` or convexity, bisect between 0 and `d` (12 steps, error under
  1/4000 of the move) and use the furthest valid position. The edge stops at the limit and stays with the finger's
  last legal point, rather than freezing wherever the last accepted pointer event happened to land.
- **Angle limits.** Not needed for edges (A keeps angles). For corners, see decision 8.
- **Snapping.** None. Clamping already gives the border "for free": overshoot and the edge sits exactly on the border.
  Snapping to the detected position would only help when the detected side is parallel to the dragged one, which is
  rare after any edit.

### Visuals

The stage is pinned dark in both themes, so one design serves both.

```
   phone, 390 px, stage about 350 x 297 px              desktop, 1440 px

   +-----------------------------------+                 handle at rest      while dragging the top edge
   |  ( )-------=====--------( )       |
   |   |                       |       |                 ( ) corner, 44 px target, 20 px dot
   |   |                       |       |                 ===  edge pill, 28 x 8 px, dark core,
   |  ||                       ||      |                      2 px emerald border, rotated to the edge
   |   |                       |       |                 ###  active pill, 36 x 8 px, emerald core,
   |   |                       |       |                      2 px dark border; edge line 3 px
   |  ( )-------=====--------( )       |
   +-----------------------------------+                 ( )-------#####--------( )   <- 3 px emerald line
                                                                  (O)  loupe above the finger,
   side edges show the pill rotated 90 degrees                         reticle is a line along the edge
```

- **Handle.** A 44 x 44 px round target (`size-11`, same as corners) centred on the edge midpoint, containing a pill
  28 x 8 px: `rounded-full border-2 border-primary bg-background/80 shadow`, the same recipe as the corner dot. Only the
  inner pill is rotated to the edge's on-screen angle (inline `rotate`, computed, like today's `left`/`top`), so the
  focus ring stays a circle like the corners'.
- **Active (dragging or keyboard-moving).** The pill grows to 36 x 8 px and swaps colours: `bg-primary` core with a 2 px
  `border-background/80`. Keeping both colours in each state means the handle has a dark edge on white paper and an
  emerald edge on a dark table. The dragged edge is drawn again on top of the outline as a 3 px `stroke-primary` line;
  the other three stay 2 px.
- **Hover (fine pointer).** Pill core `bg-primary/30`. Cursor from the edge's normal: `ns-resize`, `nesw-resize`,
  `ew-resize` or `nwse-resize`, picked by the nearest 45 degree sector.
- **Contrast (WCAG 1.4.11, 3:1 for UI parts).** Emerald `#34d399` on the dark core (`#0a0a0b` at 80%) is about 6:1
  over white paper and 10:1 over a dark table; the dark core against white paper is about 11:1. Both states pass against any photo. Emerald alone on white paper is only
  about 1.9:1, which is why neither state is emerald-only. The existing outline and focus ring are emerald-only and
  fade on white paper; see decision 9.
- **Short edges and small quads.** Corner targets have a 22 px radius, so an edge target clears both corner targets
  when the edge is at least 88 px on screen. With an 8 px margin: **show the pill only when the edge is at least 96 px
  long on screen.** Below that, the pill and its pointer target are hidden (`pointer-events-none`, transparent), but the
  button stays in the tab order and shows the pill while it has keyboard focus, so a keyboard user never loses the
  control or their focus. Corners always win on overlap anyway (see hit testing).
  At 390 x 844 the stage is about 337 px tall and the photo box at most 350 x 297; a 3:4 portrait photo fills about
  223 x 297 px. A receipt that fills 60% of the photo's width has a top edge of about 134 px (pill shown); a narrow long
  receipt at 40% has about 89 px (top and bottom pills hidden, side pills shown, which are the ones a long receipt
  needs). On desktop the stage is large and every pill shows.
- **Clipping at the border.** The photo box is inset 20 px in the stage, so a handle on the photo border loses 2 px of
  its 44 px target to `overflow-hidden`. Corners have the same issue today. Raise `pad` to 22 (half a target): the
  photo shrinks by 4 px, nothing else moves.
- **Loupe during an edge drag.** One loupe, not two: the thing being aligned is the side against the paper's edge, and
  that is under the finger. Centre it on the point of the dragged edge nearest the finger (clamped to the middle 80% of
  the edge), placed exactly as for corners. Its reticle is one line along the edge's angle instead of the crosshair,
  so the magnified view shows the crop line against the paper. Same canvas, same `clipLoupe`, same one draw per frame.

### Hit testing and focus order

- Each edge is its own `<button>`, like the corners, so the browser does the hit testing. **Corner beats edge** by
  stacking: corner buttons get `z-10`, edge buttons none. No custom hit-test code.
- DOM (and Tab) order follows the perimeter: Top-left corner, Top edge, Top-right corner, Right edge, Bottom-right,
  Bottom edge, Bottom-left, Left edge. Stacking is set with `z-index`, not by DOM order, so the two do not fight.
- One drag at a time: a `pointerdown` while a drag is active is ignored, and moves from any other `pointerId` are
  ignored. Today a second finger silently takes over the drag.

### Keyboard and screen readers

- Label: "Top edge, 12% down" / "Left edge, 8% across", from the edge midpoint, mirroring the corner labels ("Top-left
  corner, 10% across, 20% down"). Name from `EDGE_NAMES`.
- Arrow keys reuse `arrowDelta` (1%, Shift 5%) and the same projection as dragging: on the top or bottom edge, Up and
  Down move it, and Left and Right do nothing (their projection on the normal is about zero; still `preventDefault` so
  the panel does not scroll). On a tilted edge the step across it is the arrow step times the cosine of the tilt.
- Hints (`aria-describedby`), one per orientation:
  - Top and bottom edges: "Drag to move this whole side, or use the Up and Down arrow keys. Hold Shift for bigger
    steps."
  - Left and right edges: the same with "Left and Right arrow keys".
  - Corners keep theirs.
- Visible hint under the controls becomes: "Drag a corner or the middle of a side to the edge of the receipt. You can
  also select one and use the arrow keys." (Two short sentences, literal, no idiom.)
- The `role="button"` stays for edges, for consistency with corners. A slider role would let VoiceOver users on a phone
  adjust an edge by swiping up and down, which corners can never offer (they are two-dimensional); worth a follow-up
  issue, not this change.

### Engineering

**`lib/capture/geometry.ts`** (pure, no state):

```ts
export const EDGE_NAMES = ["Top", "Right", "Bottom", "Left"] as const;

/**
 * Moves edge `edge` (corner edge -> edge + 1) `distance` outward along its normal, measured in
 * pixel proportions (x scaled by `aspect` = width / height), each of its corners sliding along
 * the line to its other neighbour. Angles are unchanged. Assumes a convex quad.
 */
export function slideEdge(quad: Quad, edge: number, distance: number, aspect: number): Quad;

/** Unit outward normal of `edge` in pixel proportions (points away from the quad's centroid). */
export function edgeNormal(quad: Quad, edge: number, aspect: number): Point;
```

**`lib/capture/edit-state.ts`:**

```ts
/**
 * Moves `edge` of `from` (the quad at drag start) by the part of `delta` (normalised) that runs
 * across it, clamped to the image, and stopped at the last valid position before corners get
 * closer than MIN_GAP. Returns `state` itself when nothing moves.
 */
export function moveEdge(
  state: EditState,
  edge: number,
  from: Quad,
  delta: Point,
  aspect: number,
): EditState;

export function nudgeEdge(
  state: EditState,
  edge: number,
  dx: number,
  dy: number,
  aspect: number,
): EditState;
```

`aspect` comes from `rotatedSize(...)` (exact), not the rounded box. Computing from the drag-start quad and the total
delta (not per-event increments) means no drift, and clamping is stateless.

**`crop-editor.tsx`:**

- Replace `dragging: number | null` with one ref:
  `{ kind: "corner" | "edge"; index; pointerId; start: Point; quad: Quad }`, and the `dragIndex` state with
  `active: { kind, index } | null` (drives the loupe, the active pill and the 3 px edge line).
- `onPointerMove`: `delta = pointFrom(event) - drag.start`; edge: `moveEdge(edit, i, drag.quad, delta, aspect)`.
- The loupe effect keys on the focus point and reticle angle instead of the dragged corner's x/y. It still runs one
  `requestAnimationFrame` per change and draws only the loupe canvas.
- Helpers for the overlay (midpoint, on-screen length, angle) are a few lines each; put them next to `slideEdge` so
  they are unit-tested.

**Performance.** The main canvas is drawn only when `bitmap` or `rotation` changes; an edge drag changes the quad
only, so it never redraws the photo. Each pointer move re-renders the SVG and eight buttons, as corner drags already
do. If a profile on a mid-range Android phone shows frames over budget, batch `onChange` into one call per animation
frame; do not add it before measuring.

**Unit tests to add** (existing tests stay as they are):

- `geometry.test.ts`, `slideEdge`: on the full frame, Top moved 0.1 inward puts both top corners at y 0.1 with x
  unchanged; on the `skewed` quad, the moved corners stay on their neighbouring lines (cross product about 0) and the
  edge stays parallel; `cornerAngles` unchanged to 1e-9; with aspect 2, the perpendicular distance moved, measured in
  pixels, equals `distance`; distance 0 returns an equal quad. `edgeNormal` points outward for all four edges.
- `edit-state.test.ts`, `moveEdge`: dragging the top of the full frame upward returns the same state (`toBe`); dragging
  a tilted edge past the border stops with its first corner on the border and the edge still parallel; dragging the
  top far past the bottom stops at the `MIN_GAP` limit rather than refusing (corners within 1e-3 of the limit, quad
  convex); a delta along the edge returns the same state; calling twice with the same `from` and `delta` gives the same
  quad (no drift); after `rotateClockwise`, edge 0 is still the visual top; `isDetected` false and `editKey` changes
  after an edge move. `nudgeEdge`: ArrowDown on Top moves it by `NUDGE`, ArrowLeft on Top returns the same state.

**E2E additions** (`apps/web/e2e/capture.spec.ts`):

- Keyboard: focus "Top edge", press Shift+ArrowDown; its label changes, and both "Top-left corner" and "Top-right
  corner" labels change.
- Pointer: drag "Bottom edge" 40 px up with the mouse; the loupe shows during the drag and goes after; both bottom
  corners' labels change. Add this drag to the existing "no action moves the stage or the controls" loop.
- Corner priority: `document.elementFromPoint` at a corner's centre returns that corner's button.
- No photo redraw: an init script wraps `CanvasRenderingContext2D.prototype.drawImage` and counts calls on the canvas
  labelled "Receipt photo"; the count is the same before and after a corner drag and an edge drag.
- Tab order: from "Top-left corner", Tab reaches "Top edge".

### Smaller improvements to the free-hand feel

| Item                                                                                                             | Recommendation                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Corners keep the grab offset (move by the finger's delta from where it touched) instead of jumping to the finger | **Do it.** Touching a handle 15 px off-centre no longer jumps the corner. Same drag ref and code path as edges.                                                              |
| A refused corner move stops at the limit (same bisection) instead of freezing at the last accepted event         | **Do it.** Shares the helper; corners and edges then behave the same at limits.                                                                                              |
| Escape during a drag cancels it and restores the start quad                                                      | **Do it**, desktop. `stopPropagation` so the sheet's Escape (back) does not also fire.                                                                                       |
| Loupe keeps the side it chose at drag start (with 20 px hysteresis) instead of flipping                          | **Do it**, see Part 2.                                                                                                                                                       |
| Dark under-stroke for the outline and a dark offset for the focus ring, so both stay visible on white paper      | **Do it** (decision 9).                                                                                                                                                      |
| Dragging inside the quad moves the whole crop                                                                    | **No.** Rarely what a receipt needs, and easy to trigger by accident. Inside the quad does nothing, as today. Pinch-zoom on the stage is the better follow-up for precision. |
| Double-tap a corner to reset it to the detected position                                                         | **No.** A hidden gesture that competes with tap-to-focus; Reset already exists.                                                                                              |
| Haptic tick when an edge hits the border (`navigator.vibrate`)                                                   | **No.** Android only, not on iOS Safari; inconsistent.                                                                                                                       |

## Part 2: layout stability across the review sheet

The sheet's own comment says "the layout never changes size between actions", and the e2e test "no action moves the
stage or the controls" guards the stage, the primary button, the photo strip, the controls and the size line. What it
does not cover: horizontal movement inside the size line, the open size picker, the difference between the two steps,
and transient (one-frame) jumps, because it measures 400 ms after each action. Findings below are from reading the
code; each needs a recorded check (screenshots or a trace) when it is fixed. I did not run the app for this spec.

| Area                                           | What shifts today, and why                                                                                                                                                                                                                                                                                                                                                                                        | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Size line ("800 × 1730 px · ~471 KB · Change") | The owner's example. Numbers are `tabular-nums`, but the digit count changes ("800" vs "1200", "471 KB" vs "1.2 MB"), so the text width changes. On a phone the line is centred (`justify-center`), so the whole line and the "Change" button move sideways; on desktop it is left-aligned, so "· Change" and the chevron move.                                                                                   | Give each number a fixed slot in the mono face: width and height `inline-block min-w-[4ch] text-right` (the long edge is at most 6000, so 4 digits), the size value `min-w-[4ch] text-right` (at most "1023" KB or "9.9" MB). Units are always two letters. The line's width is then constant and nothing moves. Keep it centred on phones.                                                                                                      |
| Size line while the estimate recomputes        | Any edit change (including a filter) changes `editKey`, so `fresh` is false for at least 100 ms plus the small render: `options` becomes `[]`, the line switches from the button to a "sizing…" paragraph (different width), and the open picker unmounts and remounts. The picker area collapses and grows back: a vertical jump of everything below it.                                                         | Keep the last estimate for the photo on screen while the new one is computed (the old one is still in `estimates[current.id]`; only `fresh` hides it). Show it dimmed (`opacity-60`, `aria-busy="true"` on the line) and keep the picker mounted with the old options. Show "sizing…" only when this photo has never had an estimate, and give it the same slot widths. Upload stays allowed: it encodes for real and does not use the estimate. |
| Size picker segments (phone)                   | Switching Smaller / Recommended changes only colours (`has-checked:bg-primary/10`, text colour; the radio dot is `border-box`), so the segments themselves do not move. Risk to check: three `flex-1` segments with `whitespace-nowrap` "1600 px · ~2.4 MB" are about 106–114 px wide against about 111 px available at 375 px; a segment that does not fit grows and the three become unequal.                   | Add `min-w-0` to each segment and let the size text wrap under the label (`flex-wrap`, or two lines: "1600 px" / "~2.4 MB") so all three are equal at 375 px. Confirm with a 375 px screenshot at the longest values.                                                                                                                                                                                                                            |
| Size disclosure open / close                   | Opening inserts the picker (about 80 px on a phone, more on desktop) and pushes the hint and alerts down. The footer has `mt-auto`, so the Upload button stays put while the panel has room; on a short phone (375 x 667) the panel scrolls and Upload is pushed below the fold.                                                                                                                                  | A shift the person asked for is expected and is not counted as layout shift. Keep the disclosure. On open, `scrollIntoView({ block: "nearest" })` the picker, and keep the existing "every control is reachable on a short phone" test. Alternative: a sticky footer on phones (decision 14).                                                                                                                                                    |
| Preview image box                              | The stage is a fixed box (`h-[clamp(12rem,40dvh,34rem)]` on phones, flex on desktop), and `ResultPreview` keeps the last frame until the new one is decoded, so filter and size changes do not resize or blank it. Size changes do not re-render the preview at all. Two content flickers remain: switching photos unmounts it ("Finding the receipt…") and then shows "Preparing the preview…" before the image. | Box: no change. Content: one loading line instead of two in a row ("Preparing the preview…" for both), in the same place. Optional: keep each photo's last preview frame (keyed by photo and `editKey`) so returning from Adjust corners with no change shows it at once.                                                                                                                                                                        |
| Filter thumbnails                              | Fixed boxes (`h-14` / `md:h-24`, border always 2 px, transparent when not chosen), so no layout shift. They blank whenever the crop's shape key changes, including when coming back from Adjust corners on the same photo, then fill in about 50 ms later.                                                                                                                                                        | Keep the previous thumbnails while new ones render when the photo is the same (only the crop changed); blank them only for a different photo, so another photo's strip is never shown.                                                                                                                                                                                                                                                           |
| Upload button and "Adjust corners" link        | Stable. The link is kept `invisible` on the adjust step, so it reserves its row; the primary button is full width, so label changes ("Next", "Upload 3 receipts", "Preparing 2 of 3…") and the spinner icon do not change its box. Alerts insert above the footer, which is bottom-anchored.                                                                                                                      | No change. The e2e test already compares the primary button inside each step; add the comparison across the step switch (below).                                                                                                                                                                                                                                                                                                                 |
| Switch between Adjust corners and Preview      | The stage box stays the same (tested). The panel content does not: the adjust controls are one row of 44 px buttons and a `min-h-8` hint, the preview has the filter strip (about 84 px) plus the `h-11` size line and the `h-12` hint. The hint moves by about 40 px between steps, and on a short phone so does the Upload button once the panel scrolls.                                                       | Give the controls block the same fixed height in both steps (the filter strip's: about `h-[5.5rem]` on phones; on desktop the taller of the two), and the text block under it the same fixed height in both steps (`h-11` + `h-12`). Then only the content inside those boxes changes.                                                                                                                                                           |
| Crop stage on first show                       | `stage` starts at 0 x 0 and is set by a `ResizeObserver` callback, so the first render puts the box at 0 x 0 and all four handles at the stage centre; the next frame moves them into place. This can show for a frame.                                                                                                                                                                                           | Measure once in a `useLayoutEffect` (`getBoundingClientRect`) before the first paint, keep the observer for later changes, and render the overlay and handles only once the size is known.                                                                                                                                                                                                                                                       |
| Crop stage on Rotate                           | The box and handles take the new size in the render, but the canvas is redrawn in a `useEffect`, after paint: for one frame the old picture is stretched into the new box under the new handles.                                                                                                                                                                                                                  | Draw the canvas in `useLayoutEffect` (the draw costs the same, it just happens before paint). Confirm on a phone that the frame time is acceptable; the draw is already capped at 2 MP.                                                                                                                                                                                                                                                          |
| Crop stage height on phones                    | `40dvh` changes whenever the browser's toolbar shows or hides, which rescales the photo and moves every handle. The sheet is a fixed full-screen dialog, so this may rarely happen, but it can on some Android browsers.                                                                                                                                                                                          | Use `40svh` (small viewport height, which never changes with the toolbar). The panel below takes the difference.                                                                                                                                                                                                                                                                                                                                 |
| Loupe position during a drag                   | It sits above the finger, but flips to the side when `top < 4`, and picks left or right by which half of the stage the finger is in. Dragging near the top, or across the middle near the top, makes it jump from one place to another, sometimes every few frames.                                                                                                                                               | Choose the placement at drag start and keep it for the drag; change it only when the loupe would leave the stage, with 20 px hysteresis on both the top test and the left/right test. Also draw its first frame in a layout effect so it never shows an empty disc.                                                                                                                                                                              |

### E2E guard

Extend "no action moves the stage or the controls" (it runs at 375, 390 and 1280 px):

1. **Watch during, not only after.** A helper `watchBoxes(page, testIds, action, ms = 600)` installs an in-page
   `requestAnimationFrame` loop that records `getBoundingClientRect()` of each element every frame, runs the action,
   and returns the largest change per element. Assert at most 1 px. This catches the one-frame jumps that the current
   "settle then measure" misses. In Chromium, also collect `layout-shift` entries with a `PerformanceObserver` and log
   their sources, as a second signal (not asserted, since input-driven shifts are reported too).
2. **Size line.** Add `data-testid` to the "Change" button. With the picker closed and then open: choose each size and
   assert the size line, the Change button, the picker and the primary button do not move.
3. **Recompute with the picker open.** Open the picker, click each filter, and assert during the action (step 1) that
   the picker stays visible and nothing below it moves.
4. **Across steps.** Compare the primary button, the photo strip, the controls block and the hint block between Adjust
   corners and Preview (today only the stage is compared).
5. **Rotate.** After Rotate, every corner handle's centre lies on the canvas's drawn area (inside the canvas box), in
   every frame the watcher records.
6. **Edge drag.** The new edge drag in Part 1 joins the existing corner drag in this test.

## Owner decisions

Recommended default first in each.

1. **What an edge drag does.** (a) Slide along the neighbouring sides, edge stays parallel, angles kept; (b) translate
   along the normal; (c) follow the finger freely.
2. **When a move hits a limit.** (a) Stop at the limit, for edges and corners alike; (b) freeze at the last accepted
   position, as corners do today.
3. **Short edges.** (a) Hide the pill and its pointer target below 96 px on screen, keep it reachable by keyboard;
   (b) always show it with a smaller target; (c) a different threshold.
4. **Corner drags keep the grab offset** (no jump to the finger). (a) Yes; (b) no, keep today's behaviour.
5. **Dragging inside the crop.** (a) Does nothing, as today; (b) moves the whole crop.
6. **Double-tap a corner to reset it.** (a) No; (b) yes.
7. **Escape during a drag cancels it.** (a) Yes; (b) no.
8. **Angle limits on manual corner drags** (45–135 degrees, as detection uses). (a) No, a person may mean it; (b) yes,
   refuse or stop at the limit.
9. **Outline and focus ring on white paper.** (a) Add a dark under-stroke and a dark ring offset, so both meet 3:1 on
   any photo; (b) leave as today.
10. **Step title.** (a) Keep "Adjust corners" (known term; also the Preview link's label and the tests'); (b) rename
    to "Adjust crop" everywhere.
11. **Snapping.** (a) None (clamping at the border is enough); (b) snap edges to the detected outline within 8 px.
12. **Size line numbers.** (a) Fixed-width slots so the line never changes width; (b) left-align the line on phones too
    (the "Change" part still moves).
13. **While the size estimate recomputes.** (a) Keep the previous values dimmed and keep the picker open; (b) show
    "sizing…" as today.
14. **Size picker on short phones.** (a) Keep the disclosure, scroll it into view when opened; (b) make the Upload row
    sticky at the bottom of the panel on phones, so nothing can push it off screen (costs about 100 px of scrolling room
    at 375 x 667).
15. **Same panel height in both steps.** (a) Yes, fixed controls and hint blocks; (b) no, let them differ.
16. **Stage height on phones.** (a) `40svh`; (b) keep `40dvh`.
17. **Canvas draw before paint on Rotate.** (a) Yes, `useLayoutEffect`; (b) keep `useEffect` and accept one stretched
    frame.

### Decided, 2026-11-09

The owner took option (a) in all 17 decisions above. Two notes from the same day apply to Part 2:

- The size options are now Compact, Standard and Sharpest ([sizing review](../reviews/2026-11-09-upload-sizing.md)),
  and the size line shows the real encoded file's bytes, not an estimate. So "while the size estimate recomputes"
  (decision 13) means while the real encode runs: the last values stay on screen, dimmed, and the picker stays open
  with its options (their pixel sizes are known at once from the crop's shape).
- File size: normal photos at about 500–700 KB or less, 1.5 MB only in exceptional cases (decision 3 of the sizing
  review, as changed by the owner).

Part 2's review-sheet items (fixed number slots, the dimmed recompute, equal picker segments, scrolling the picker
into view, one loading line, keeping the filter strip for the same photo, the same panel blocks in both steps, `40svh`,
and the frame-by-frame e2e watcher) ship with the sizing change. Part 1 and the crop-stage items of Part 2 (first
measurement, drawing before paint on Rotate, the loupe's placement) ship with the edge handles.
