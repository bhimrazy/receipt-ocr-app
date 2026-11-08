import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card } from "@receipt-ocr/ui/components/card";
import { Check } from "lucide-react";

/** One plan in a pricing grid: name, price, what's included and its call to action. */
export function PlanCard({
  name,
  price,
  cadence,
  description,
  features,
  cta,
  badge,
  featured = false,
}: {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: React.ReactNode;
  badge?: string;
  featured?: boolean;
}) {
  return (
    <Card
      className={`card-sheen relative flex flex-col p-7 ${
        featured ? "border-primary/40 bg-primary/4" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{name}</h3>
        {badge ? <Badge>{badge}</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-1.5">
        <span className="font-mono text-3xl font-bold tracking-tight">{price}</span>
        <span className="text-sm text-muted-foreground">{cadence}</span>
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
