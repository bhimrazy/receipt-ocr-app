import { ogSize, renderOgImage } from "@/lib/og-image";

export const alt = "ReceiptOCR terms of service";
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "ReceiptOCR",
    accent: "Terms of service",
    caption: "Your account, your receipts, and the free plan",
  });
}
