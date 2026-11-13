import type { HeroArtName } from "@/lib/content/types";

// Decorative only: every SVG here is aria-hidden, and the page text says the same thing.
// Fixed dimensions keep layout stable; colours come from theme tokens via Tailwind classes.

const STROKE = "stroke-primary";
const BOX = "fill-primary/10 stroke-primary";
const CARD = "fill-card stroke-primary/60";
const DASHED = "fill-none stroke-primary/50";
const LABEL = "fill-muted-foreground font-mono";
const BAR = "fill-muted-foreground/35";

function Glow({ id }: { id: string }) {
  return (
    <>
      <defs>
        <radialGradient cx="50%" cy="50%" id={id} r="50%">
          <stop offset="0%" style={{ stopColor: "var(--primary)", stopOpacity: 0.18 }} />
          <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0 }} />
        </radialGradient>
        <marker
          id={`${id}-arrow`}
          markerHeight="6"
          markerWidth="6"
          orient="auto-start-reverse"
          refX="5"
          refY="3"
        >
          <path className="fill-primary/70" d="M0,0 L6,3 L0,6 z" />
        </marker>
      </defs>
      <ellipse cx="160" cy="110" fill={`url(#${id})`} rx="160" ry="110" />
    </>
  );
}

/** A small receipt with its amount on the top line, which stays visible when cards are stacked. */
function MiniReceipt({ x, y, amount }: { x: number; y: number; amount: string }) {
  return (
    <g>
      <rect className={CARD} height="96" rx="6" strokeWidth="1.25" width="80" x={x} y={y} />
      <text className="fill-foreground font-mono" fontSize="9" x={x + 10} y={y + 18}>
        {amount}
      </text>
      <line
        className="stroke-muted-foreground/40"
        strokeDasharray="2 2"
        x1={x + 8}
        x2={x + 72}
        y1={y + 28}
        y2={y + 28}
      />
      <rect className={BAR} height="3" rx="1.5" width="56" x={x + 10} y={y + 40} />
      <rect className={BAR} height="3" rx="1.5" width="48" x={x + 10} y={y + 50} />
      <rect className={BAR} height="3" rx="1.5" width="52" x={x + 10} y={y + 60} />
    </g>
  );
}

function CsvFile({
  x,
  y,
  w,
  h,
  name,
  rows,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  rows: string[];
}) {
  return (
    <g>
      <rect className={BOX} height={h} rx="8" strokeWidth="1.25" width={w} x={x} y={y} />
      <text className="fill-primary font-mono" fontSize="9" x={x + 10} y={y + 17}>
        {name}
      </text>
      <line className={STROKE} strokeOpacity="0.4" x1={x} x2={x + w} y1={y + 26} y2={y + 26} />
      {rows.map((row, i) => (
        <text className={LABEL} fontSize="8" key={row} x={x + 10} y={y + 42 + i * 15}>
          {row}
        </text>
      ))}
    </g>
  );
}

const TRIP_RECEIPTS: Array<[number, number, string]> = [
  [16, 48, "99.88"],
  [44, 74, "415.84"],
  [72, 100, "26.05"],
];

function TripArt() {
  return (
    <>
      <Glow id="art-trip" />
      <rect className={BOX} height="20" rx="10" strokeWidth="1" width="136" x="16" y="14" />
      <text className="fill-primary font-mono" fontSize="9" x="26" y="28">
        Client visit, Toronto
      </text>
      {TRIP_RECEIPTS.map(([x, y, amount]) => (
        <MiniReceipt amount={amount} key={amount} x={x} y={y} />
      ))}
      {/* After the cards, from the part of each right edge the next card doesn't cover. */}
      {TRIP_RECEIPTS.map(([x, y, amount]) => (
        <path
          className={DASHED}
          d={`M${x + 80} ${y + 14} C 176 ${y + 14}, 172 116, 194 116`}
          key={amount}
          markerEnd="url(#art-trip-arrow)"
          strokeDasharray="3 3"
        />
      ))}
      <CsvFile
        h={92}
        name="trip.csv"
        rows={["Harbour Grill  99.88", "Harbourview  415.84", "City Cab      26.05"]}
        w={112}
        x={198}
        y={70}
      />
    </>
  );
}

function PersonGlyph({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="fill-none stroke-primary" strokeWidth="1.5">
      <circle cx={cx} cy={cy - 5} r="5" />
      <path d={`M${cx - 9} ${cy + 10} a9 8 0 0 1 18 0`} />
    </g>
  );
}

function ClientArt() {
  return (
    <>
      <Glow id="art-client" />
      <rect className={BOX} height="132" rx="10" strokeWidth="1.25" width="124" x="16" y="44" />
      <text className="fill-primary font-mono" fontSize="9" x="28" y="64">
        Client workspace
      </text>
      {[80, 104, 128, 152].map((y) => (
        <g key={y}>
          <rect className={CARD} height="18" rx="4" strokeWidth="1" width="100" x="28" y={y} />
          <rect className={BAR} height="3" rx="1.5" width="44" x="36" y={y + 7.5} />
          <rect className="fill-primary/60" height="3" rx="1.5" width="18" x="100" y={y + 7.5} />
        </g>
      ))}
      <path
        className={DASHED}
        d="M144 84 L214 84"
        markerEnd="url(#art-client-arrow)"
        strokeDasharray="3 3"
      />
      <text className={LABEL} fontSize="8" x="160" y="76">
        invite
      </text>
      <circle className={BOX} cx="248" cy="84" r="26" strokeWidth="1.25" />
      <PersonGlyph cx={248} cy={84} />
      <text className="fill-foreground font-mono" fontSize="9" textAnchor="middle" x="248" y="126">
        You
      </text>
      <rect className={CARD} height="36" rx="8" strokeWidth="1" width="96" x="200" y="160" />
      <text className={LABEL} fontSize="8" x="212" y="182">
        Next client
      </text>
      <path
        className={DASHED}
        d="M248 134 L248 154"
        markerEnd="url(#art-client-arrow)"
        markerStart="url(#art-client-arrow)"
        strokeDasharray="3 3"
      />
      <text className={LABEL} fontSize="8" x="256" y="147">
        switch
      </text>
    </>
  );
}

const MONTHS = [
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "01",
  "02",
  "03",
  "04",
];

function TaxYearArt() {
  const cell = 18;
  const step = 20;
  const x0 = 10;
  return (
    <>
      <Glow id="art-tax" />
      <text className={LABEL} fontSize="8" x={x0} y="30">
        2026
      </text>
      <text className={LABEL} fontSize="8" x={x0 + 11 * step} y="30">
        2027
      </text>
      {MONTHS.map((month, i) => {
        const inYear = i >= 2 && i <= 13;
        return (
          <g key={`${month}-${i}`}>
            <rect
              className={inYear ? BOX : "fill-none stroke-muted-foreground/30"}
              height="34"
              rx="4"
              strokeWidth="1"
              width={cell}
              x={x0 + i * step}
              y="38"
            />
            <text
              className={inYear ? "fill-primary font-mono" : LABEL}
              fontSize="8"
              textAnchor="middle"
              x={x0 + i * step + cell / 2}
              y="58"
            >
              {month}
            </text>
          </g>
        );
      })}
      <path
        className="fill-none stroke-primary/70"
        d={`M${x0 + 2 * step} 80 v6 H${x0 + 13 * step + cell} v-6`}
        strokeWidth="1.25"
      />
      <text className="fill-primary font-mono" fontSize="9" textAnchor="middle" x="160" y="100">
        your tax year
      </text>
      <path
        className={DASHED}
        d="M160 106 L160 128"
        markerEnd="url(#art-tax-arrow)"
        strokeDasharray="3 3"
      />
      <CsvFile
        h={76}
        name="expenses.csv"
        rows={["Software   24.00", "Equipment 138.00"]}
        w={124}
        x={98}
        y={134}
      />
    </>
  );
}

const ROLES = ["Member", "Manager", "Owner"];
const HISTORY = [
  ["Northside", "94.83"],
  ["QuickFuel", "61.20"],
  ["Riverside", "446.53"],
  ["Hosting", "23.80"],
];

function TeamArt() {
  return (
    <>
      <Glow id="art-team" />
      {ROLES.map((role, i) => {
        const cy = 50 + i * 60;
        return (
          <g key={role}>
            <circle className={BOX} cx="34" cy={cy} r="18" strokeWidth="1.25" />
            <PersonGlyph cx={34} cy={cy} />
            <text className="fill-foreground font-mono" fontSize="9" x="58" y={cy + 3}>
              {role}
            </text>
            <path
              className={DASHED}
              d={`M110 ${cy} C 140 ${cy}, 150 110, 176 110`}
              markerEnd="url(#art-team-arrow)"
              strokeDasharray="3 3"
            />
          </g>
        );
      })}
      <rect className={BOX} height="150" rx="10" strokeWidth="1.25" width="126" x="182" y="35" />
      <text className="fill-primary font-mono" fontSize="9" x="194" y="54">
        Receipts
      </text>
      <line className={STROKE} strokeOpacity="0.4" x1="182" x2="308" y1="62" y2="62" />
      {HISTORY.map(([name, amount], i) => (
        <g key={name}>
          <text className={LABEL} fontSize="8" x="194" y={82 + i * 24}>
            {name}
          </text>
          <text
            className="fill-foreground font-mono"
            fontSize="8"
            textAnchor="end"
            x="298"
            y={82 + i * 24}
          >
            {amount}
          </text>
        </g>
      ))}
    </>
  );
}

const FIELDS = ["merchant", "date", "tax", "total"];

function PipelineArt() {
  return (
    <>
      <Glow id="art-pipe" />
      <rect className={CARD} height="118" rx="6" strokeWidth="1.25" width="78" x="12" y="46" />
      <rect className={BAR} height="4" rx="2" width="44" x="24" y="60" />
      {[78, 88, 98, 108].map((y) => (
        <rect className={BAR} height="3" key={y} rx="1.5" width="54" x="24" y={y} />
      ))}
      <line
        className="stroke-muted-foreground/40"
        strokeDasharray="2 2"
        x1="22"
        x2="80"
        y1="124"
        y2="124"
      />
      <rect className="fill-primary/60" height="4" rx="2" width="30" x="24" y="138" />
      <text className={LABEL} fontSize="8" textAnchor="middle" x="51" y="184">
        photo or PDF
      </text>
      <path
        className={DASHED}
        d="M96 105 L114 105"
        markerEnd="url(#art-pipe-arrow)"
        strokeDasharray="3 3"
      />
      <rect className={BOX} height="118" rx="8" strokeWidth="1.25" width="96" x="120" y="46" />
      {FIELDS.map((field, i) => (
        <g key={field}>
          <text className="fill-primary font-mono" fontSize="8" x="130" y={68 + i * 26}>
            {field}
          </text>
          <rect className={BAR} height="3" rx="1.5" width="30" x="176" y={65 + i * 26} />
        </g>
      ))}
      <text className={LABEL} fontSize="8" textAnchor="middle" x="168" y="184">
        rows you check
      </text>
      <path
        className={DASHED}
        d="M222 105 L240 105"
        markerEnd="url(#art-pipe-arrow)"
        strokeDasharray="3 3"
      />
      <path className={BOX} d="M246 62 h46 l14 14 v72 h-60 z" strokeWidth="1.25" />
      <path className="fill-none stroke-primary" d="M292 62 v14 h14" strokeWidth="1.25" />
      <text className="fill-primary font-mono" fontSize="10" textAnchor="middle" x="276" y="112">
        .csv
      </text>
      <text className={LABEL} fontSize="8" textAnchor="middle" x="276" y="184">
        CSV or JSON
      </text>
    </>
  );
}

const ARTS: Record<HeroArtName, () => React.JSX.Element> = {
  pipeline: PipelineArt,
  trip: TripArt,
  client: ClientArt,
  "tax-year": TaxYearArt,
  team: TeamArt,
};

/** The hero illustration for a page or hub; hidden below lg by the caller. */
export function HeroArt({ name }: { name: HeroArtName }) {
  const Art = ARTS[name];
  return (
    <svg
      aria-hidden
      className="h-auto w-full max-w-[320px]"
      fill="none"
      height="220"
      viewBox="0 0 320 220"
      width="320"
    >
      <Art />
    </svg>
  );
}

/** Three labelled nodes joined by dashed arrows, for a tile. */
export function NodeDiagram({ nodes }: { nodes: [string, string, string] }) {
  return (
    <svg
      aria-hidden
      className="h-auto w-full max-w-[220px]"
      height="36"
      viewBox="0 0 220 36"
      width="220"
    >
      {nodes.map((label, i) => (
        <g key={label}>
          <rect
            className={i === 1 ? BOX : CARD}
            height="24"
            rx="6"
            strokeWidth="1"
            width="62"
            x={i * 79}
            y="6"
          />
          <text
            className={i === 1 ? "fill-primary font-mono" : "fill-foreground font-mono"}
            fontSize="9"
            textAnchor="middle"
            x={i * 79 + 31}
            y="21"
          >
            {label}
          </text>
          {i < 2 ? (
            <line
              className="stroke-primary/50"
              strokeDasharray="3 3"
              x1={i * 79 + 64}
              x2={i * 79 + 77}
              y1="18"
              y2="18"
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}

/**
 * Connectors from receipt lines (left) to CSV columns (right), one row every `rowHeight` px.
 * `highlight` names the links drawn in full primary; the rest are faint.
 */
export function FieldConnectors({
  links,
  rows,
  rowHeight,
  width,
}: {
  links: Array<{ from: number; to: number; highlight: boolean }>;
  rows: number;
  rowHeight: number;
  width: number;
}) {
  const height = rows * rowHeight;
  const mid = (row: number) => row * rowHeight + rowHeight / 2;
  return (
    <svg aria-hidden fill="none" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      {links.map((link) => (
        <path
          className={link.highlight ? "stroke-primary" : "stroke-primary/30"}
          d={`M2 ${mid(link.from)} C ${width / 2} ${mid(link.from)}, ${width / 2} ${mid(link.to)}, ${width - 2} ${mid(link.to)}`}
          key={`${link.from}-${link.to}`}
          strokeDasharray={link.highlight ? undefined : "3 3"}
          strokeWidth={link.highlight ? 1.5 : 1}
        />
      ))}
    </svg>
  );
}
