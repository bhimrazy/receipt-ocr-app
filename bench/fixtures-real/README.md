# Real receipt fixtures

Real receipt photos for the OCR benchmark, alongside the synthetic `bench/fixtures/`. Each image has a ground-truth
`.json` in the same format; `_source`, `_license` and `_notes` say where it came from and anything ambiguous.

Key format: every field is always present, and `null` means "not printed or not legible on the image" (the model should
return null too). `merchant` and `category` are lists of acceptable values, first one preferred. `receiptDate` is the AD
date. `subtotal` is the pre-tax goods line the receipt prints (Sub Total, Gross Amount), else `null`. Item names are as
printed; `quantity` is 1 when none is printed, and `totalPrice` is the line amount after any line discount. Service
charges, discounts and rounding have no field, so `_notes` shows how the total adds up.

| Folder                          | What                                                                                                                                     | Licence                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`cord/`](cord/README.md)       | 5 Indonesian receipts from CORD v1 (long, discounts, service and tax, low light). Merchant and date were blurred by the dataset authors. | CC BY 4.0                |
| [`commons/`](commons/README.md) | 4 photos from Wikimedia Commons: Hong Kong, Poland, Nepal (BS and AD dates), Croatia.                                                    | CC0 / CC BY-SA, per file |

These files are **not** covered by the repository's LICENSE: each keeps its own licence and credit, listed in its
folder's README. Add only images whose licence is verified per file, never photos with someone's personal data.
Private or unlicensed receipts go in the gitignored `bench/fixtures-local/` instead.

Run: `bun run bench:ocr --fixtures bench/fixtures-real/cord` (the flag lands with the Anthropic provider PR).
