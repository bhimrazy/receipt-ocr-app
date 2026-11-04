import { DM_Sans } from "next/font/google";

// Loaded only by /final-classic. Same family as the app, but with the optical-size axis so large
// headings get the tighter display cut. Text and mono stay on the app's global fonts.
export const display = DM_Sans({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fc-display",
  display: "swap",
});
