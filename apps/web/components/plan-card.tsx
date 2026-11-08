import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check } from "lucide-react";

/**
 * One plan in a pricing grid: name, price, what's included and its call to action. Cards in a
 * grid row share a height, and the list grows so every CTA sits on the same line.
 *
 * `featured` is the plan we point people to. `quiet` is a plan without a public price ("Let's
 * talk"): no sheen, and the price reads as text, not a figure.
 */
export function PlanCard({
  name,
  price,
  cadence,
  description,
  features,
  cta,
  badge,
  featured = false,
  quiet = false,
}: {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: React.ReactNode;
  badge?: string;
  featured?: boolean;
  quiet?: boolean;
}) {
  return (
    <Card
      className={cn(
        "relative flex flex-col p-7",
        quiet ? "bg-transparent" : "card-sheen",
        featured && "border-primary/40 bg-primary/4 shadow-xl shadow-primary/10 lg:-my-2 lg:py-9",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{name}</h3>
        {badge ? <Badge>{badge}</Badge> : null}
      </div>
      <div className="mt-3 flex min-h-9 flex-wrap items-baseline gap-x-1.5">
        <span
          className={
            quiet
              ? "text-2xl font-semibold tracking-tight"
              : "font-mono text-3xl font-bold tracking-tight"
          }
        >
          {price}
        </span>
        {cadence ? <span className="text-sm text-muted-foreground">{cadence}</span> : null}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <ul className="mt-6 flex flex-1 flex-col gap-3 text-sm">
        {features.map((feature) => (
          <li className="flex items-start gap-2.5" key={feature}>
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-7">{cta}</div>
    </Card>
  );
}
