import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What receiptOCR collects, who processes it, including Google's Gemini AI, and how to delete it.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="November 4, 2026"
      intro="receiptOCR reads the receipts you upload and turns them into data you can check and export. This policy explains what we collect, who processes it on our behalf, and how you can remove it."
      sections={[
        {
          heading: "What we collect",
          body: [
            "Account details: your name, email address and password (stored only as a hash). If you sign in with Google or GitHub, we receive your name, email address and profile picture from that provider.",
            "Receipts: the images you upload and the data we extract from them, such as merchant, date, line items, tax, total, category and a confidence score, plus any corrections you make.",
            "Workspace details: the workspaces you create or join, their members and the invitations you send.",
            "Messages: if you contact us through the support form, your email address and your message.",
            "Technical data: a session cookie that keeps you signed in, and server logs (such as which request was made, when, and any errors) that we use to run the service and investigate errors.",
          ],
        },
        {
          heading: "How we use it",
          body: [
            "To run the service: sign you in, read your receipts, store your history, let you edit and export it, and send account emails such as password resets and workspace invitations.",
            "To keep the service working and secure, for example by enforcing usage limits and investigating errors.",
            "To reply when you contact us.",
            "We don't sell your data, and we don't use it for advertising.",
          ],
        },
        {
          heading: "Who processes your data",
          body: [
            "Google (Gemini API): every receipt image you upload is sent to Google's Gemini AI model, which reads it and returns the extracted data. Google processes the image under its terms for the Gemini API.",
            "Hosting, database and file storage providers store your account details, receipt data and images on our behalf.",
            "An email delivery provider sends account emails such as password resets and invitations.",
            "Google and GitHub, only if you choose to sign in with them.",
            "Members of your workspace can see the receipts in that workspace. Nobody outside it can.",
          ],
        },
        {
          heading: "How long we keep it",
          body: [
            "We keep your account and receipts until you delete them.",
            "Deleting a receipt removes it and its extracted data from your history. Deleting your account from Settings removes your account and the receipts you uploaded.",
            "The original image files are not yet removed from file storage automatically when you delete a receipt or your account. We're fixing this. Until then, contact us through the support form and we'll remove them for you.",
          ],
        },
        {
          heading: "Your choices",
          body: [
            "Export: download any receipt, or everything in your workspace, as a CSV at any time.",
            "Correct: edit the merchant, date, category and amounts on any receipt.",
            "Delete: remove any receipt, or your whole account, from the app.",
            "Ask: contact us through the support form to request a copy of your data or to ask about anything in this policy.",
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
