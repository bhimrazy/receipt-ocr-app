import { Fraunces, Geist, IBM_Plex_Mono } from "next/font/google";

// Loaded only by /landing-d; the variables are applied on the page wrapper, not <html>.
export const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
  variable: "--font-d-display",
  display: "swap",
});

export const sans = Geist({
  subsets: ["latin"],
  variable: "--font-d-sans",
  display: "swap",
});

export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-d-mono",
  display: "swap",
});
