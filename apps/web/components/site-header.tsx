import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { SiteHeaderBar } from "@/components/site-header-bar";

export type NavLink = { href: string; label: string };

const defaultLinks: NavLink[] = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

/** Marketing header. Server-side so the button classes are resolved here, not in the browser. */
export function SiteHeader({ links = defaultLinks }: { links?: NavLink[] }) {
  return (
    <SiteHeaderBar
      ghostClass={cn(buttonVariants({ variant: "ghost" }), "h-11 px-2.5 sm:px-4 lg:h-10")}
      links={links}
      primaryClass={cn(buttonVariants(), "h-11 px-3.5 sm:px-4 lg:h-10")}
    />
  );
}
