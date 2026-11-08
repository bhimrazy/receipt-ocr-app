import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, X } from "lucide-react";
import { FieldConnectors, NodeDiagram } from "@/components/content/content-art";
import { CONTENT_ICONS } from "@/components/content/content-icons";
import type { ContentIconName, ContentSection } from "@/lib/content/types";

/** The landing page's icon tile. */
export function IconTile({ icon, className }: { icon: ContentIconName; className?: string }) {
  const Icon = CONTENT_ICONS[icon];
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary",
        className,
      )}
    >
      <Icon aria-hidden className="size-5" />
    </div>
  );
}

function Steps({ steps }: { steps: NonNullable<ContentSection["steps"]> }) {
  return (
    <ol className="relative grid gap-4 md:grid-cols-4">
      {/* Dashed connector behind the icon row, between the first and last card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[12%] top-[2.625rem] hidden border-t border-dashed border-primary/30 md:block"
      />
      {steps.map((step, index) => (
        <li key={step.title}>
          <Card className="relative h-full p-5">
            <div className="flex items-center gap-3">
              <IconTile className="bg-background" icon={step.icon} />
              <span className="font-mono text-xs text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-4 font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
          </Card>
        </li>
      ))}
    </ol>
  );
}

function Tiles({ tiles }: { tiles: NonNullable<ContentSection["tiles"]> }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <li key={tile.title}>
          <Card className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <IconTile icon={tile.icon} />
              {tile.chip ? (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 font-mono text-2xs text-primary">
                  {tile.chip}
                </span>
              ) : null}
            </div>
            <h3 className="mt-4 font-semibold">{tile.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{tile.body}</p>
            {tile.diagram ? (
              <div className="mt-auto pt-4">
                <NodeDiagram nodes={tile.diagram} />
              </div>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DoesDoesnt({ does, doesnt }: { does: string[]; doesnt: string[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-primary">It does</h3>
        <ul className="mt-4 flex flex-col gap-3 text-sm leading-6">
          {does.map((item) => (
            <li className="flex gap-3" key={item}>
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h3 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          It doesn&apos;t
        </h3>
        <ul className="mt-4 flex flex-col gap-3 text-sm leading-6 text-muted-foreground">
          {doesnt.map((item) => (
            <li className="flex gap-3" key={item}>
              <X aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// Both columns use this row height and top inset, so the connectors line up with the rows.
const ROW = 28;
const CONNECTOR_WIDTH = 72;

function FieldMap({ map }: { map: NonNullable<ContentSection["fieldmap"]> }) {
  const rows = Math.max(map.lines.length, map.fields.length);
  // Tax and total are the lines people most often get wrong by hand.
  const links = map.fields.flatMap((field, to) =>
    field.from === undefined
      ? []
      : [{ from: field.from, to, highlight: field.name === "tax" || field.name === "total" }],
  );
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-0">
      <div className="relative overflow-hidden rounded-lg border border-dashed border-hairline bg-background/60 p-4 font-mono text-xs text-muted-foreground">
        <div aria-hidden className="scan-line pointer-events-none absolute inset-x-0 top-0" />
        <p className="sr-only">Printed receipt lines</p>
        <ul>
          {map.lines.map((line, i) => {
            const strong = map.fields.some(
              (f) => f.from === i && (f.name === "tax" || f.name === "total"),
            );
            return (
              <li
                className={cn(
                  "flex h-7 items-center justify-between gap-3 rounded px-2",
                  strong && "bg-primary/10 text-foreground",
                  i === 0 && "text-foreground",
                )}
                key={`${line.text}-${i}`}
              >
                <span className="truncate">{line.text}</span>
                {line.amount ? <span className="tabular-nums">{line.amount}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="hidden pt-[17px] md:block">
        <FieldConnectors links={links} rowHeight={ROW} rows={rows} width={CONNECTOR_WIDTH} />
      </div>
      <div className="rounded-lg border border-transparent p-4">
        <p className="sr-only">CSV columns</p>
        <ul>
          {map.fields.map((field) => {
            const source = field.from === undefined ? field.note : map.lines[field.from]?.text;
            const strong = field.name === "tax" || field.name === "total";
            return (
              <li className="flex h-7 items-center gap-2 font-mono text-xs" key={field.name}>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-2 py-0.5",
                    strong
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-secondary/40 text-foreground",
                  )}
                >
                  {field.name}
                </span>
                <span className="truncate tabular-nums text-foreground">{field.value || "—"}</span>
                {source ? (
                  <span className="ml-auto truncate text-2xs text-muted-foreground">
                    {field.from === undefined ? source : `← ${source}`}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** What follows a section's paragraphs, per its layout. */
export function SectionBody({ section }: { section: ContentSection }) {
  switch (section.layout) {
    case "steps":
      return section.steps ? <Steps steps={section.steps} /> : null;
    case "tiles":
      return section.tiles ? <Tiles tiles={section.tiles} /> : null;
    case "does-doesnt":
      return <DoesDoesnt does={section.does ?? []} doesnt={section.doesnt ?? []} />;
    case "fieldmap":
      return section.fieldmap ? <FieldMap map={section.fieldmap} /> : null;
    default:
      return null;
  }
}

const SHARED_FACTS = ["12 categories", "CSV + JSON", "Per-line confidence"];

/** Short facts under the hero on md and up; none are numbers the product can't back. */
export function FactTiles({ fact }: { fact: string }) {
  return (
    <ul className="hidden gap-3 md:grid md:grid-cols-4">
      {[...SHARED_FACTS, fact].map((text) => (
        <li
          className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-3 font-mono text-xs text-foreground"
          key={text}
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
          {text}
        </li>
      ))}
    </ul>
  );
}
