import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { gaMeasurementId, turnstileOn } from "@/lib/consent/env";
import { formatLegalDate, LEGAL_UPDATED, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy policy",
  description:
    "What receiptOCR collects, who processes it (Gemini, Claude and, if enabled, Groq or OpenAI), how long it is kept and how to delete it.",
  path: "/privacy",
});

const googleAnalytics = Boolean(gaMeasurementId);
// Vercel Web Analytics runs only in Vercel builds.
const pageCounts = process.env.VERCEL === "1";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={formatLegalDate(LEGAL_UPDATED.privacy)}
      intro="receiptOCR reads the receipts you upload and turns them into data you can check and export. This policy explains what we collect, who processes it on our behalf, and how you can remove it."
      sections={[
        {
          heading: "What we collect",
          body: [
            "Account details: your name, email address and password (stored only as a hash). If you sign in with Google or GitHub, we receive your name, email address and profile picture from that provider.",
            "Receipts: the photos and PDFs you upload and the data we extract from them, such as merchant, date, line items, tax, total, category and a confidence score, plus any corrections you make.",
            "Workspace details: the workspaces you create or join, their members and the invitations you send.",
            "Messages: if you write to us through the support button, your email address and your message.",
            "Technical data: a session cookie that keeps you signed in and a few other necessary cookies (all listed in the cookie policy), server logs (such as which request was made, when, and any errors) that we use to run the service and investigate errors, and short-lived counters that limit how often we send account emails to one address (they hold a one-way hash of the address, not the address).",
          ],
        },
        {
          heading: "How we use it",
          body: [
            "To run the service: sign you in, read your receipts, store your history, let you edit and export it, and send account emails such as password resets and workspace invitations.",
            "To keep the service working and secure, for example by enforcing usage limits and investigating errors.",
            "To reply when you contact us.",
            ...(googleAnalytics || pageCounts
              ? [
                  "To count visits to our public pages and see which ones help people, as described under Cookies and analytics.",
                ]
              : []),
            "We don't sell your data, and we don't use it for advertising.",
          ],
        },
        {
          heading: "Who processes your data",
          body: [
            "Google (Gemini API) and Anthropic (Claude API): every receipt file you upload is sent to an AI model from one of these providers, which reads it and returns the extracted data. We choose the models and the order they are tried in, and we may change them. A file goes to the next provider only if the first can't read it, for example because it is slow, busy or unavailable, declines the file, can't take its type or size, or returns an answer we can't use. If a read is retried, the file may be sent again. Each provider handles the file under the terms of its paid API. Under those terms, neither provider uses your receipts to train its models, and each keeps a copy for a limited time only to check for misuse.",
            "Groq (GroqCloud API), only if we or your workspace turn it on: the receipt file is sent to a model Groq hosts, which reads it the same way. Groq doesn't keep the file or the result by default, but may log them for up to 30 days to keep the service reliable and to check for misuse, stored in the United States. On our own Groq account we turn on Groq's zero data retention setting, which stops that logging.",
            "OpenAI (OpenAI API), only if we or your workspace turn it on: the receipt file is sent to a model OpenAI hosts, which reads it the same way. OpenAI doesn't use data sent to its API to train its models unless a customer opts in, and we don't. It may keep requests and responses for up to 30 days to check for abuse, unless the law requires longer. We ask OpenAI not to store the response for reuse. Zero data retention is available only with OpenAI's prior approval and is not part of this setup.",
            "Hosting, database and file storage providers store your account details, receipt data and files on our behalf. Photos are re-encoded in your browser before upload, which removes camera metadata such as location. PDFs, and HEIC files your browser can't convert, are stored as uploaded.",
            "An email delivery provider sends account emails such as password resets and invitations.",
            "Google and GitHub, only if you choose to sign in with them.",
            ...(pageCounts
              ? [
                  "Vercel Web Analytics: counts visits to our public pages (home, sign-in, sign-up and legal pages) without cookies. Vercel receives the page address without its query string, the referring site, and your IP address and browser details, which it uses to tell visits apart with a hash it discards after 24 hours. It never runs inside the app.",
                ]
              : []),
            ...(googleAnalytics
              ? [
                  "Google Analytics: only if you accept analytics cookies, on the same public pages. Google receives the page address without its query string, your IP address and browser details, and sets the _ga cookies. Ads features and Google signals are off.",
                ]
              : []),
            ...(turnstileOn
              ? [
                  "Cloudflare Turnstile: to tell people from bots, the sign-up, sign-in, password reset and contact forms run a Cloudflare Turnstile check. Cloudflare receives your IP address and browser details such as user agent and screen settings, and may set a cookie, under its own terms.",
                ]
              : []),
            "Only you and the people you invite to your workspace can see its receipts. receiptOCR administrators can access an account only to handle a support request.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "We keep your account and receipts until you delete them.",
            "Deleting a receipt removes it, its extracted data and its original file.",
            "Deleting your account from Settings removes your account and every workspace where you are the only member, with all of its receipts and files. Receipts you uploaded to a workspace shared with other people stay in that workspace, without your name on them, because they belong to the workspace. If you are the only owner of a shared workspace, make another member an owner first.",
            "For billing and to enforce plan limits, we keep a usage record of each time the AI read a receipt: which model, how many tokens, the estimated cost and when. It holds no receipt contents or images. It stays after you delete the receipt, the workspace or your account, but is then no longer linked to them or to you.",
          ],
        },
        {
          heading: "Cookies and analytics",
          body: [
            googleAnalytics
              ? "We use necessary cookies to run the service, and Google Analytics cookies only if you accept them in the cookie banner or Cookie settings."
              : "We use only necessary cookies, which keep you signed in, protect sign-in and remember your choices. We don't use advertising or tracking cookies.",
            "Analytics never runs inside the app or the admin area. We honour Global Privacy Control (which turns off Google Analytics and page counts) as a request not to sell or share your data, and Do Not Track as a request not to be measured.",
            "You can change or withdraw your choice at any time with Cookie settings in the footer, the sign-in pages and the account menu. The cookie policy lists every cookie and storage key, what it does and how long it lasts.",
          ],
          links: [{ label: "Cookie policy", href: "/cookies" }],
        },
        {
          heading: "Your choices",
          body: [
            "Export: download any receipt, or everything in your workspace, as a CSV at any time.",
            "Correct: edit the merchant, date, category, currency and amounts on any receipt.",
            "Delete: remove any receipt, or your whole account, from the app.",
            "Ask: use the support button at the bottom right of this page to request a copy of your data or to ask about anything in this policy.",
          ],
        },
        {
          heading: "Changes",
          body: [
            "If we change this policy, we'll update the date at the top of this page. If a change significantly affects how we use your data, we'll tell you by email before it takes effect.",
          ],
        },
      ]}
    />
  );
}
