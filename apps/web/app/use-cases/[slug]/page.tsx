import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPageView } from "@/components/content/content-page";
import { contentMetadata, contentPageAt, pagesIn } from "@/lib/content";
import { useCasesCollection } from "@/lib/content/use-cases";

// Only the slugs in lib/content are pages; anything else is a 404 at build time.
export const dynamicParams = false;

export function generateStaticParams() {
  return pagesIn("use-cases").map((page) => ({ slug: page.slug }));
}

const pageFor = async (params: Promise<{ slug: string }>) =>
  contentPageAt(`${useCasesCollection.path}/${(await params).slug}`);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = await pageFor(params);
  return page ? contentMetadata(page) : {};
}

export default async function UseCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const page = await pageFor(params);
  if (!page) notFound();
  return <ContentPageView page={page} />;
}
