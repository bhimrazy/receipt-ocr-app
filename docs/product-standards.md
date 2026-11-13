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
- Copy is plain and literal for an international reader: no idioms or regional references that need explaining
  ("shoebox", "tax season", "April"). (2026-11-04)

- A screen never asks for an action it can't offer: "Upgrade" appears only beside a control that starts it. While
  checkout is closed the copy says Pro opens soon. (2026-11-13)
- Server error messages follow the same rule: they are shown without a control, so they state the limit and what the
  reader can do now, never "upgrade". (2026-11-13)
- A page has one name everywhere it is mentioned, legal pages and server messages included ("Plan and billing", not
  "Billing" or "Settings, Billing"). (2026-11-13)

## Billing

- A subscriber's billing page is decided by the subscription first and the checkout state second: anyone who pays can
  always reach status, renewal, cancel and invoices, or is told on that page how. (2026-11-13)
- When a role can't do something, the page says who can. No button for an action the viewer can't take. (2026-11-13)
- A usage warning shows from 80% used on the pages where scanning starts, at every width; nothing pitches Pro below
  that. (2026-11-13)

## Data display

- Waits over 48 hours are given in days with the date ("1 December, in 18 days"), never in hours. (2026-11-13)

- Every page works at 390px with no horizontal scroll and a way to reach every section of the app. (2026-11-04)
- Amounts show the currency symbol consistently, with numeric columns right-aligned in monospace. (2026-11-04)
- Usage and limit numbers shown to users are real, never placeholders. (2026-11-04)
- Receipts that failed or are still processing say so in plain words, with no placeholder values ("Untitled", "$0.00",
  "0%") and with the next action (retry, wait). (2026-11-04)

## Quality gates

- QA covers every view at 1440 and 390 with Playwright screenshots, which go in a scratch directory and never into the
  repo. (2026-11-04)
- Before merge: `bun run typecheck`, `bun run test` and `bun run build` pass and the screenshot pass shows no regressions.
  (2026-11-04)
