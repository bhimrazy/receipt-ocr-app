import { ogSize, renderOgImage } from "@/lib/og-image";

export const alt = "receiptOCR privacy policy";
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "receiptOCR",
    accent: "Privacy policy",
    caption: "What we collect, who processes it, and how to delete it",
  });
}
