# Security policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue, pull request or discussion.

- **Preferred:** use GitHub's private vulnerability reporting. Open the repository's **Security** tab and choose
  **Report a vulnerability**, or go to
  <https://github.com/bhimrazy/receipt-ocr-app/security/advisories/new>.
- **Email:** write to the support inbox of the deployment you tested (the address configured as `SUPPORT_EMAIL`):
  `SECURITY_CONTACT_EMAIL` (placeholder, filled in by the maintainer). Put "Security" in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. A proof of concept helps, but
keep it minimal.

## What to expect

- We confirm receipt within 3 working days.
- We send an assessment and a planned fix date within 10 working days.
- We tell you when the fix ships, and credit you in the advisory if you want.

## Scope

In scope: this repository and the hosted receiptOCR app built from it, including sign-in, workspaces, receipt
uploads, storage and the admin panel.

Out of scope: denial of service by volume, spam or social engineering, findings that need a compromised device or
browser, missing headers without a working attack, and reports from automated scanners without a reproduction.

## Testing rules

- Use only accounts and workspaces you own. Do not access, change or delete other people's data.
- Do not upload real receipts that belong to someone else.
- Stop and report as soon as you can show the problem; do not keep exploiting it.
- Keep the details private until a fix ships.

We will not take legal action against research done in good faith under these rules.

## Supported versions

Only the latest `main` (and the hosted app deployed from it) receives security fixes.
