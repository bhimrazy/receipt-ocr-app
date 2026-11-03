# Product standards

Checks every user-facing change must pass. Most come from owner corrections; when the owner flags something new, add
it here in the same session, with the date. `product-reviewer` checks every line.

## Direction

- Keep it simple: no abstraction, package or service until a second real use needs it. Best-practice and performant
  beats clever. (2026-11-04)
- Local development runs entirely in Docker (Postgres, RustFS); anything external (OCR, email) is simulated or
  optional locally. (2026-11-04)
- Runtimes and images track the current LTS: Node 24, Postgres 18. (2026-11-04)

## Claims and content

- The site never claims a feature, number or guarantee the product can't back up today. Planned features are labelled
  as coming, not presented as shipped. (2026-11-04)

## Data display

- Every page works at 390px with no horizontal scroll and a way to reach every section of the app. (2026-11-04)
- Amounts show the currency symbol consistently, with numeric columns right-aligned in monospace. (2026-11-04)
- Usage and limit numbers shown to users are real, never placeholders. (2026-11-04)
- Receipts that failed or are still processing say so in plain words, with no placeholder values ("Untitled", "$0.00",
  "0%") and with the next action (retry, wait). (2026-11-04)

## Quality gates

- QA covers every view at 1440 and 390 with Playwright screenshots, which go in a scratch directory and never into the
  repo. (2026-11-04)
- Before merge: `pnpm typecheck`, `pnpm test` and `pnpm build` pass and the screenshot pass shows no regressions.
  (2026-11-04)
