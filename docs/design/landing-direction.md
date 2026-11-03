# Landing page direction (2026-11-04)

Three directions for the public landing page, built as real pages for the owner to compare. They live at
`/landing-a`, `/landing-b` and `/landing-c` (route group `app/(lab)`, `noindex`) and share their parts in
`apps/web/components/marketing/`. Copy follows `docs/product-standards.md`: no claim the code can't back up today.
The persona is freelancers and small businesses first, developers second (product and market reviews of 2026-11-04).

## Research: patterns worth borrowing

Sources were read on 2026-11-04.

1. **Show the output as the hero.** Veryfi pairs a receipt with a "Receipt in. JSON out." panel, and Mindee animates
   files flowing into a JSON response with confidence scores. Linear opens on a real product screen, not an
   illustration. We have no customers to quote yet, so real output is our strongest proof.
   [veryfi.com/receipt-ocr-api](https://www.veryfi.com/receipt-ocr-api/), [mindee.com](https://www.mindee.com/),
   [linear.app](https://linear.app/)
2. **Alternate copy with product fragments, not card grids.** Linear's sections pair a short headline with a UI
   fragment and use "Fig 0.1" numbering, which gives an editorial, technical rhythm. This fixes the "template
   rhythm" in design review P5. [linear.app](https://linear.app/)
3. **Put reassurance under the CTA.** Mindee puts "no credit card" and compliance badges under the hero button. We
   can't claim SOC 2, so ours is "Free · No card required · 50 receipts a day".
   [mindee.com](https://www.mindee.com/)
4. **Price in included quantities.** Vercel shows each plan as included amounts ("1M / month included") with a
   "Custom / Contact sales" tier. Taggun, Veryfi and Ramp hide prices behind links, and the market review shows
   that costs trust with freelancers. We show the one real plan as numbers and label the rest as coming.
   [vercel.com/pricing](https://vercel.com/pricing), [taggun.io](https://www.taggun.io/),
   [ramp.com/expense-management](https://ramp.com/expense-management)
5. **Use transparency when you have no logos.** Veryfi lists 150+ supported fields and Mindee shows per-field
   confidence. Without customer logos, the honest version is a spec of what we enforce, plus naming the AI processor
   (Google Gemini). No competitor we looked at says where the image goes in plain words.

Not borrowed: unsourced outcome percentages (Veryfi's "reduce processing time by 90%"), logo strips, customer counts.

## Direction A: Ledger split

- **Concept:** Product-led. Split hero: "Snap a receipt. Get a spreadsheet." on the left, and a paper receipt behind
  the extracted-data panel on the right. A strip of facts replaces the stats band. "How it works" is three
  alternating Fig. 01–03 rows (upload queue, edit form, CSV), then a features list, a two-card pricing section, a
  split FAQ and a CTA.
- **Serves best:** First-time visitors who want to see the product before they read about it, freelancers and
  developers alike.
- **Strengths:** The clearest of the three, it shows the real output above the fold, and it's closest to today's
  code, so it's cheapest to ship.
- **Risks:** The most conventional layout, so it looks most like other SaaS pages. The pricing pair is honest, but
  it's still a card grid.

## Direction B: Shoebox

- **Concept:** Editorial and pain-led, for the tax-time freelancer. A centred display-serif headline, "Your receipts,
  *sorted* before tax time.", with paper receipts turning into CSV rows. Then an "old way / with receiptOCR"
  comparison, three acts (i. ii. iii.), a "your data" block that names Google Gemini, and a one-line price: "Free.
  50 receipts a day. No card." The coming-soon items sit underneath.
- **Serves best:** Freelancers and small-business owners, the primary persona.
- **Strengths:** The most distinctive and the warmest. The plain-language data promises answer the trust gap the
  reviews call out, and the one-sentence price is unmissable.
- **Risks:** Adds a third typeface (Instrument Serif, display only, loaded through `next/font`). It speaks less to
  developers, and it's the longest page.

## Direction C: Spec sheet

- **Concept:** Precision and transparency. Mono headline: "Receipts, read line by line." The hero is a tab viewer
  (Photo / Fields / CSV / JSON) of the same receipt. Then a four-step pipeline, a spec table of limits enforced in
  code, a "where your data goes" flow (device → private storage → Google Gemini → your workspace), and pricing as a
  printed receipt that ends "TOTAL DUE $0.00".
- **Serves best:** Detail-minded bookkeepers and developers, the secondary persona.
- **Strengths:** The most honest proof format: every number is enforced, and the data flow is explicit. The receipt
  pricing is memorable.
- **Risks:** Heavy mono reads technical to freelancers. The tabs need client JS, and on mobile only one view shows
  at a time.

## Scores

1 is weak and 5 is strong. For build cost, 5 means cheapest.

| | Clarity | Trust | Distinctiveness | Conversion intent | Mobile | Build cost |
|---|---|---|---|---|---|---|
| A Ledger split | 5 | 4 | 3 | 4 | 4 | 4 |
| B Shoebox | 4 | 5 | 5 | 4 | 4 | 3 |
| C Spec sheet | 4 | 5 | 4 | 3 | 4 | 3 |

## Recommendation

**B (Shoebox), with C's "Where your data goes" flow in place of B's three-promise block.**
- B is the only direction written for the persona the reviews chose. It looks least like an AI template, and its
  pricing line states the real plan with no fine print.
- C's named data flow is the best trust device across all three: it turns a legal disclosure into proof.
- Keep A's split hero in reserve: if the owner wants to appeal more to developers later, it's the easiest to adapt.

The shared parts (header, footer, previews, FAQ, plan data) are identical across directions, so whichever is chosen
becomes `app/page.tsx` with little extra work, and the `(lab)` route group is then deleted.
