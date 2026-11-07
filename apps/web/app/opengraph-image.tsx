import { ogSize, renderOgImage } from "@/lib/og-image";

export const alt = "receiptOCR: Turn receipt photos into spreadsheet rows";
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "Turn receipt photos into",
    accent: "spreadsheet rows",
    caption: "Merchant · Items · Tax · Total, checked and exported to CSV",
  });
}
