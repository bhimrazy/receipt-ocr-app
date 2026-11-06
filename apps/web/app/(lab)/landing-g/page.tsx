import { IBM_Plex_Mono, Inter_Tight } from "next/font/google";
import { DirectionG } from "@/components/marketing/v2/g/landing";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-g-sans", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-g-mono",
  display: "swap",
});

export const metadata = { title: "Landing direction G" };

export default function Page() {
  return <DirectionG fontClassName={`${sans.variable} ${mono.variable}`} />;
}
