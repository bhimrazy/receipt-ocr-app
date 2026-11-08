# Email templates: one file per template, no committed generated HTML (2026-11-08)

Status: noted, not scheduled. Owner's ask: split the templates and get rid of the committed generated file, which
works against the reason we chose React Email.

## Today

- All 12 messages live in one file, [`src/emails/templates.tsx`](../../packages/email/src/emails/templates.tsx)
  (~600 lines), next to `layout.tsx` and `theme.ts`.
- `bun run email:generate` prerenders every template twice into
  [`src/generated.ts`](../../packages/email/src/generated.ts) (~400 KB of HTML strings with `{{slot}}`
  placeholders), committed. The runtime fills slots with escaping (`render.ts`) and never loads React or Tailwind.
- Every copy change means editing the big file, regenerating, and a 400 KB diff in review.

## Why it was built that way

No React, React Email or Tailwind in the server bundle or on the cold path; builds and tests need no generation step;
slot placement is checked at generate time (no placeholder in `<style>`, URL slots only at the start of an attribute).
Those properties are worth keeping; the committed blob and the single file are not.

## Proposal

1. **One file per template**: `src/emails/templates/<name>.tsx`, each exporting its `EmailDefinition` (subject,
   preheader, slots, render). An `index.ts` registry lists them. Shared pieces stay in `layout.tsx` and `theme.ts`.
   Pure move, no copy change; the golden tests prove the output is identical.
2. **Stop committing `generated.ts`**. Pick one, measured first:
   - **A. Generate at build (recommended to try first).** A turbo task `email:generate` runs before `build`,
     `typecheck` and `test`, writing a gitignored file. Keeps the zero-React runtime and the slot checks; costs a
     few seconds per build. Vercel and the Docker image run it as part of `bun run build`.
   - **B. Render at runtime** with `@react-email/render`. Simplest code (no slots, no generator), but React and
     Tailwind go into the server bundle and each send renders a React tree. Only if A turns out awkward and a
     cold-start measurement on Vercel shows the render cost is small (target under 50 ms per send).
3. **Keep** `email:check`-style protection only if we stay on A (a stale file can't happen when it's never
   committed, so the check goes away), the golden tests, and `bun run email:preview` for local previews.

## Done when

- Each template is its own file and a copy change touches one file only.
- No generated HTML in the repo; CI, Vercel and Docker builds still pass.
- Golden tests show byte-identical HTML and text for every template before and after the move.
- `docs/architecture/email.md` describes the new flow.
