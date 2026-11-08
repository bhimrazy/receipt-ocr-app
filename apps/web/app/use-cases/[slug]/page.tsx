import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPageView } from "@/components/content/content-page";
import { contentMetadata, findContentPage, pagesIn } from "@/lib/content";

// Only the slugs in lib/content are pages; anything else is a 404 at build time.
export const dynamicParams = false;

export function generateStaticParams() {
  return pagesIn("use-cases").map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = findContentPage("use-cases", (await params).slug);
  return page ? contentMetadata(page) : {};
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const page = findContentPage("use-cases", (await params).slug);
  if (!page) notFound();
  return <ContentPageView page={page} />;
}
