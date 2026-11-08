import type { Metadata } from "next";
import { ContentHubView } from "@/components/content/content-page";
import { collectionMetadata } from "@/lib/content";
import { useCasesCollection } from "@/lib/content/use-cases";

export const metadata: Metadata = collectionMetadata(useCasesCollection);

export default function UseCasesPage() {
  return <ContentHubView collection={useCasesCollection} />;
}
