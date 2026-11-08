import { PRO_PRICE_LABEL } from "./pricing";

// Shared by the landing page FAQ, its FAQPage JSON-LD and llms-full.txt.
export const homeFaqs = [
  {
    q: "What file formats can I upload?",
    a: "JPEG, PNG, WebP, HEIC or PDF. Phone photos are shrunk in your browser before upload; PDFs up to 4 MB.",
  },
  {
    q: "How accurate is the extraction?",
    a: "Each receipt gets an overall confidence score and each line item gets its own. Receipts below the threshold, lines that were hard to read, and totals that don't add up are flagged so you know what to check.",
  },
  {
    q: "Where is my receipt data stored?",
    a: "Receipt files are kept in private cloud storage and the extracted data in our database. Receipts are scanned by Google Gemini; see the privacy policy for details. You can export your data at any time.",
  },
  {
    q: "Is it really free to start?",
    a: `Yes. The free plan needs no credit card and includes a daily and monthly allowance of receipt scans. When a workspace needs more, Pro is ${PRO_PRICE_LABEL.month} a month or ${PRO_PRICE_LABEL.year} a year for that workspace, and you can cancel any time.`,
  },
  {
    q: "Can I export what gets extracted?",
    a: "Yes. Any receipt exports as CSV with its line items or copies as JSON, and History exports every receipt that matches your filters as one CSV.",
  },
  {
    q: "Is there an iPhone or Android app?",
    a: "ReceiptOCR is a progressive web app (PWA): install it from your browser and it opens from your home screen like any app, with no app store download. On Android and desktop Chrome, tap Get the app at the bottom of this page (or Install app in the account menu); on iPhone, in Safari tap Share (or ••• then Share), then Add to Home Screen.",
  },
];
