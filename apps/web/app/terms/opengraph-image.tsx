import { ogSize, renderOgImage } from "@/lib/og-image";

export const alt = "receiptOCR terms of service";
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "receiptOCR",
    accent: "Terms of service",
    caption: "Your account, your receipts, and the free plan",
  });
}
