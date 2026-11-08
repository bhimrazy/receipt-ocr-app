import type { Metadata } from "next";
import { NewsletterStep } from "@/components/newsletter-step";
import { pageMetadata } from "@/lib/seo";
import { unsubscribeAction } from "../actions";

export const metadata: Metadata = pageMetadata({
  title: "Product updates",
  description: "Manage your ReceiptOCR product updates subscription.",
  path: "/newsletter/unsubscribe",
  index: false,
});

type Props = { searchParams: Promise<{ t?: string; r?: string }> };

export default async function NewsletterUnsubscribePage({ searchParams }: Props) {
  const { t, r } = await searchParams;
  return <NewsletterStep action={unsubscribeAction} result={r} step="unsubscribe" token={t} />;
}
