import type { Metadata } from "next";
import { NewsletterStep } from "@/components/newsletter-step";
import { pageMetadata } from "@/lib/seo";
import { confirmAction } from "../actions";

export const metadata: Metadata = pageMetadata({
  title: "Product updates",
  description: "Manage your ReceiptOCR product updates subscription.",
  path: "/newsletter/confirm",
  index: false,
});

type Props = { searchParams: Promise<{ t?: string; r?: string }> };

export default async function NewsletterConfirmPage({ searchParams }: Props) {
  const { t, r } = await searchParams;
  return <NewsletterStep action={confirmAction} result={r} step="confirm" token={t} />;
}
