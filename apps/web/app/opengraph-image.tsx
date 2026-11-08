import { ogSize, renderOgImage } from "@/lib/og-image";
import { OG_IMAGE_ALT } from "@/lib/seo";

export const alt = OG_IMAGE_ALT;
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "Turn receipt photos into",
    accent: "structured data",
    caption: "Merchant · Items · Tax · Total, checked and exported as CSV or JSON",
  });
}
