import { Fraunces, Geist, IBM_Plex_Mono } from "next/font/google";

// Loaded only by /final-paper, applied on the page wrapper. Static weights keep the payload small:
// Fraunces 500 roman + italic for display, Geist variable for text, Plex Mono 400/500 for data.
export const display = Fraunces({
  subsets: ["latin"],
  weight: "500",
  style: ["normal", "italic"],
  variable: "--font-pp-display",
  display: "swap",
});

export const sans = Geist({
  subsets: ["latin"],
  variable: "--font-pp-sans",
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-pp-mono",
  display: "swap",
});
