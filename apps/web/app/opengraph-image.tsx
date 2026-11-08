import { ogSize, renderOgImage } from "@/lib/og-image";

export const alt = "ReceiptOCR: receipt photos and PDFs to structured data, CSV and JSON";
export const size = ogSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({
    headline: "Turn receipt photos into",
    accent: "spreadsheet rows",
    caption: "Merchant · Items · Tax · Total, checked and exported as CSV or JSON",
  });
}
