# Real receipt fixtures

Real receipt photos for the OCR benchmark, alongside the synthetic `bench/fixtures/`. Each image has a ground-truth
`.json` in the same format; `merchant` and `category` may list several acceptable values, and `_source`, `_license`
and `_notes` say where it came from and anything ambiguous.

| Folder                          | What                                                                                                                                     | Licence                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`cord/`](cord/README.md)       | 5 Indonesian receipts from CORD v1 (long, discounts, service and tax, low light). Merchant and date were blurred by the dataset authors. | CC BY 4.0                |
| [`commons/`](commons/README.md) | 4 photos from Wikimedia Commons: Hong Kong, Poland, Nepal (BS and AD dates), Croatia.                                                    | CC0 / CC BY-SA, per file |

These files are **not** covered by the repository's LICENSE: each keeps its own licence and credit, listed in its
folder's README. Add only images whose licence is verified per file, never photos with someone's personal data.
Private or unlicensed receipts go in the gitignored `bench/fixtures-local/` instead.

Run: `bun run bench:ocr --fixtures bench/fixtures-real/cord` (the flag lands with the Anthropic provider PR).
