import type { CurrencySpend, SpendDashboard, SpendRange, SpendSearch } from "@receipt-ocr/core";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import Link from "next/link";
import { BarList, ChartCard, DataTable, type BarRow } from "./chart-card";
import { DashboardControls } from "./controls";
import { NothingInRange } from "./empty-states";
import {
  change,
  formatChange,
  formatDate,
  formatDay,
  formatMoney,
  formatMonth,
  formatMonthShort,
  formatSpan,
  formatWeekday,
} from "./format";
import { LazySparkline, LazyTimeChart } from "./lazy-charts";
import { homeHref, sliceHref } from "./links";
import type { TimePoint } from "./time-chart";

const RANGE_NAMES: Record<SpendRange["preset"], string> = {
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  "12m": "Last 12 months",
  ytd: "Year to date",
  custom: "Custom range",
};

/** Last day of the month holding `iso`. */
function monthEnd(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "the previous 30 days", "the same days last year". */
function previousName(range: SpendRange) {
  if (range.previous.kind === "last-year") return "the same days last year";
  switch (range.preset) {
    case "30d":
      return "the previous 30 days";
    case "3m":
      return "the previous 3 months";
    case "12m":
      return "the previous 12 months";
    default:
      return `the previous ${formatSpan(range.previous.from, range.previous.to)}`;
  }
}

/** Picks the currency the URL asks for, else the most used. */
export function selectCurrency(dashboard: SpendDashboard, requested?: string) {
  return (
    dashboard.currencies.find((c) => c.currency === requested) ?? dashboard.currencies[0] ?? null
  );
}

export function SpendDashboardView({
  dashboard,
  search,
}: {
  dashboard: SpendDashboard;
  search: SpendSearch;
}) {
  const { range } = dashboard;
  const spend = selectCurrency(dashboard, search.currency);
  const span = formatSpan(range.from, range.to);
  const money = (value: number) => (spend ? formatMoney(value, spend.currency) : "");

  return (
    <section aria-labelledby="spending-heading" className="mt-10">
      <div className="mb-4">
        <h2 className="text-base font-semibold" id="spending-heading">
          Spending
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Read receipts by the date printed on them.{" "}
          {dashboard.currencies.length > 1
            ? "Each currency has its own totals; amounts in different currencies are never added together."
            : null}
        </p>
      </div>

      <DashboardControls
        currencies={dashboard.currencies}
        range={range}
        search={search}
        selected={spend?.currency ?? null}
      />

      {spend && spend.usesUploadDate > 0 ? (
        <p className="mb-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {plural(spend.usesUploadDate, "receipt")} without a readable date{" "}
          {spend.usesUploadDate === 1 ? "uses its" : "use their"} upload date.
        </p>
      ) : null}

      {!spend ? (
        <NothingInRange
          span={span}
          what="receipts"
          widerHref={
            range.preset === "12m"
              ? undefined
              : homeHref(search, { range: "12m", from: undefined, to: undefined })
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ThisMonthCard currency={spend.currency} month={spend.thisMonth} />
          {spend.count === 0 ? (
            <NothingInRange
              span={span}
              what={`${spend.currency} receipts`}
              widerHref={
                range.preset === "12m"
                  ? undefined
                  : homeHref(search, { range: "12m", from: undefined, to: undefined })
              }
            />
          ) : (
            <>
              <KpiTiles range={range} span={span} spend={spend} />
              <OverTimeCard range={range} span={span} spend={spend} />
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CategoryCard money={money} range={range} spend={spend} />
                <MerchantCard money={money} range={range} spend={spend} />
              </div>
            </>
          )}
          {range.preset === "12m" ? null : <MonthsCard spend={spend} />}
          {spend.count === 0 ? null : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <LargestCard money={money} spend={spend} />
              <WeekdayCard money={money} spend={spend} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Delta({ fraction, against }: { fraction: number | null; against: string }) {
  if (fraction == null) {
    return <span className="text-muted-foreground">Nothing in {against} to compare with</span>;
  }
  const Icon = fraction > 0.005 ? ArrowUpRight : fraction < -0.005 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>
        <span className="font-mono tabular-nums">{formatChange(fraction)}</span> against {against}
      </span>
    </span>
  );
}

function ThisMonthCard({
  month,
  currency,
}: {
  month: CurrencySpend["thisMonth"];
  currency: string;
}) {
  const money = (v: number) => formatMoney(v, currency);
  const lastName = formatMonth(month.lastMonth).split(" ")[0]!;
  const thisName = formatMonth(month.month);
  const days = Math.max(month.daysInMonth, month.lastMonthCumulative.length);
  const points: TimePoint[] = Array.from({ length: days }, (_, i) => ({
    label: String(i + 1),
    title: `Day ${i + 1}`,
    value: i < month.cumulative.length ? month.cumulative[i]! : null,
    previous: month.lastMonthCumulative[i] ?? null,
  }));
  const vs = change(month.toDate, month.lastMonthToDate);

  return (
    <ChartCard
      description={`${thisName}, day ${month.day} of ${month.daysInMonth}`}
      summary={
        <>
          {plural(month.count, "receipt")} so far.{" "}
          {month.lastMonthToDate > 0
            ? `By this day in ${lastName}: ${money(month.lastMonthToDate)}. ${lastName} in all: ${money(month.lastMonthTotal)}.`
            : month.lastMonthTotal > 0
              ? `Nothing by this day in ${lastName}; ${lastName} in all: ${money(month.lastMonthTotal)}.`
              : `Nothing in ${lastName}.`}
        </>
      }
      table={
        <DataTable
          caption={`Running total by day, ${thisName} and ${lastName}`}
          columns={[
            { header: "Day", cell: (p: TimePoint) => p.label },
            {
              header: thisName,
              cell: (p) => (p.value == null ? "" : money(p.value)),
              numeric: true,
            },
            {
              header: lastName,
              cell: (p) => (p.previous == null ? "" : money(p.previous)),
              numeric: true,
            },
          ]}
          rows={points}
        />
      }
      title="This month"
    >
      <div className="flex flex-col gap-1">
        <p className="text-4xl font-semibold tracking-tight md:text-5xl">{money(month.toDate)}</p>
        <p className="text-sm text-muted-foreground">
          <Delta against={`${lastName} by this day`} fraction={vs} />
        </p>
        {month.projected != null ? (
          <p className="text-sm text-muted-foreground">
            At this pace, {thisName.split(" ")[0]} ends near{" "}
            <span className="font-mono text-foreground tabular-nums">{money(month.projected)}</span>
            . A straight line from the days so far, not a forecast.
          </p>
        ) : null}
      </div>
      <LazyTimeChart
        format={{ kind: "money", currency }}
        height={160}
        kind="line"
        labels={{ value: thisName.split(" ")[0]!, previous: lastName }}
        points={points}
      />
    </ChartCard>
  );
}

function Tile({
  label,
  value,
  detail,
  spark,
  className,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  spark?: number[];
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-1 p-4", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-2xl font-semibold tracking-tight">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      {spark && spark.length > 2 ? (
        <div className="mt-auto pt-2">
          <LazySparkline values={spark} />
        </div>
      ) : null}
    </Card>
  );
}

function KpiTiles({
  spend,
  range,
  span,
}: {
  spend: CurrencySpend;
  range: SpendRange;
  span: string;
}) {
  const money = (v: number) => formatMoney(v, spend.currency);
  const against = previousName(range);
  const tiles = range.compare ? 5 : 4;
  return (
    <div
      className={cn("grid grid-cols-2 gap-3", tiles === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4")}
    >
      <Tile
        className="col-span-2 lg:col-span-1"
        detail={`${RANGE_NAMES[range.preset]}, ${span}`}
        label="Spent"
        spark={spend.series.map((b) => b.total)}
        value={money(spend.total)}
      />
      {range.compare ? (
        <Tile
          detail={<Delta against={against} fraction={change(spend.total, spend.previous.total)} />}
          label="Previous period"
          value={money(spend.previous.total)}
        />
      ) : null}
      <Tile
        detail={
          range.compare && spend.previous.count > 0
            ? `${plural(spend.previous.count, "receipt")} in ${against}`
            : undefined
        }
        label="Receipts"
        spark={spend.series.map((b) => b.count)}
        value={spend.count.toLocaleString("en-US")}
      />
      <Tile label="Average per receipt" value={money(spend.total / spend.count)} />
      <Tile detail="As printed on the receipts" label="Tax" value={money(spend.tax)} />
    </div>
  );
}

function bucketTitle(range: SpendRange, start: string, end: string) {
  if (range.unit === "day") return formatDate(start);
  if (range.unit === "month") return formatSpan(start, end);
  return `Week of ${formatSpan(start, end)}`;
}

function bucketLabel(range: SpendRange, start: string) {
  return range.unit === "month" ? formatMonthShort(start) : formatDay(start);
}

function OverTimeCard({
  spend,
  range,
  span,
}: {
  spend: CurrencySpend;
  range: SpendRange;
  span: string;
}) {
  const money = (v: number) => formatMoney(v, spend.currency);
  const points: TimePoint[] = spend.series.map((b, i) => ({
    label: bucketLabel(range, b.start),
    title: bucketTitle(range, b.start, b.end),
    value: b.total,
    previous: range.compare ? (spend.previousSeries[i]?.total ?? null) : null,
    href: b.count > 0 ? sliceHref({ from: b.start, to: b.end }) : undefined,
    partial: range.unit === "month" && b.end < monthEnd(b.start),
  }));
  const peak = spend.series.reduce(
    (best, b) => (b.total > best.total ? b : best),
    spend.series[0]!,
  );
  const unitName = { day: "Daily", week: "Weekly, from Monday", month: "Monthly" }[range.unit];
  const average =
    range.preset === "12m" && spend.monthlyAverage != null
      ? { value: spend.monthlyAverage, label: `Average ${money(spend.monthlyAverage)}` }
      : undefined;

  return (
    <ChartCard
      description={`${unitName}, ${span}`}
      summary={
        spend.count === 1
          ? `One receipt in this range: ${money(spend.total)} on ${formatDate(peak.start)}.`
          : `Highest ${range.unit}: ${bucketTitle(range, peak.start, peak.end)}, ${money(peak.total)}.${
              average ? ` Average month: ${money(average.value)}.` : ""
            }`
      }
      table={
        <DataTable
          caption={`Spend by ${range.unit}, ${span}`}
          columns={[
            {
              header: range.unit === "day" ? "Day" : range.unit === "week" ? "Week" : "Month",
              cell: (b: CurrencySpend["series"][number]) =>
                b.count > 0 ? (
                  <Link
                    className="text-primary hover:underline"
                    href={sliceHref({ from: b.start, to: b.end })}
                  >
                    {bucketTitle(range, b.start, b.end)}
                  </Link>
                ) : (
                  bucketTitle(range, b.start, b.end)
                ),
            },
            { header: "Spent", cell: (b) => money(b.total), numeric: true },
            { header: "Receipts", cell: (b) => b.count, numeric: true },
            ...(range.compare
              ? [
                  {
                    header: "Previous",
                    cell: (b: CurrencySpend["series"][number]) => {
                      const prev = spend.previousSeries[spend.series.indexOf(b)];
                      return prev ? money(prev.total) : "";
                    },
                    numeric: true,
                  },
                ]
              : []),
          ]}
          rows={spend.series}
        />
      }
      title="Spend over time"
    >
      {spend.count > 1 ? (
        <LazyTimeChart
          format={{ kind: "money", currency: spend.currency }}
          kind={range.unit === "month" ? "bar" : "area"}
          labels={{
            value: RANGE_NAMES[range.preset],
            previous: range.compare ? previousName(range).replace(/^the /, "") : undefined,
          }}
          points={points}
          reference={average}
        />
      ) : null}
    </ChartCard>
  );
}

function MonthsCard({ spend }: { spend: CurrencySpend }) {
  const money = (v: number) => formatMoney(v, spend.currency);
  const last = spend.months.at(-1)!;
  const points: TimePoint[] = spend.months.map((m, i) => {
    const current = i === spend.months.length - 1;
    return {
      label: formatMonthShort(m.month),
      title: current ? `${formatMonth(m.month)} so far` : formatMonth(m.month),
      value: m.total,
      href: m.count > 0 ? sliceHref({ from: m.month, to: monthEnd(m.month) }) : undefined,
      partial: current,
    };
  });

  return (
    <ChartCard
      description={`${formatMonth(spend.months[0]!.month)} to ${formatMonth(last.month)}`}
      summary={
        spend.monthlyAverage != null
          ? `Average month: ${money(spend.monthlyAverage)}, over the complete months since the first receipt. This month so far: ${money(last.total)}.`
          : `This month so far: ${money(last.total)}. An average appears after the first complete month.`
      }
      table={
        <DataTable
          caption="Spend by month, last 12 months"
          columns={[
            { header: "Month", cell: (p: TimePoint) => p.title },
            { header: "Spent", cell: (p) => money(p.value ?? 0), numeric: true },
          ]}
          rows={points}
        />
      }
      title="Last 12 months"
    >
      <LazyTimeChart
        format={{ kind: "money", currency: spend.currency }}
        height={200}
        kind="bar"
        labels={{ value: "Spent" }}
        points={points}
        reference={
          spend.monthlyAverage != null
            ? { value: spend.monthlyAverage, label: `Average ${money(spend.monthlyAverage)}` }
            : undefined
        }
      />
    </ChartCard>
  );
}

function OneOrBars({
  rows,
  rest,
  label,
  single,
}: {
  rows: BarRow[];
  rest: BarRow | null;
  label: string;
  single: string;
}) {
  if (rows.length === 1 && !rest) return <p className="text-sm">{single}</p>;
  return <BarList label={label} rows={rest ? [...rows, rest] : rows} />;
}

function CategoryCard({
  spend,
  range,
  money,
}: {
  spend: CurrencySpend;
  range: SpendRange;
  money: (v: number) => string;
}) {
  const { top, rest } = spend.categories;
  const rows: BarRow[] = top.map((c) => ({
    key: c.category ?? "",
    label: c.category ?? "No category",
    amount: money(c.total),
    value: c.total,
    detail: plural(c.count, "receipt"),
    href: c.category
      ? sliceHref({ from: range.from, to: range.to, category: c.category })
      : undefined,
  }));
  const restRow: BarRow | null = rest
    ? {
        key: "rest",
        label: `${plural(rest.groups ?? 0, "other category", "other categories")}`,
        amount: money(rest.total),
        value: rest.total,
        detail: plural(rest.count, "receipt"),
      }
    : null;
  const first = top[0]!;
  return (
    <ChartCard
      summary={
        top.length > 1
          ? `Most spent on ${first.category ?? "receipts with no category"}: ${money(first.total)}, ${Math.round((first.total / spend.total) * 100)}% of the total.`
          : undefined
      }
      title="By category"
    >
      <OneOrBars
        label="Spend by category"
        rest={restRow}
        rows={rows}
        single={`All ${plural(spend.count, "receipt")} ${spend.count === 1 ? "is" : "are"} ${first.category ?? "without a category"}: ${money(first.total)}.`}
      />
    </ChartCard>
  );
}

function MerchantCard({
  spend,
  range,
  money,
}: {
  spend: CurrencySpend;
  range: SpendRange;
  money: (v: number) => string;
}) {
  const { top, rest } = spend.merchants;
  const rows: BarRow[] = top.map((m) => ({
    key: m.key,
    label: m.name,
    amount: money(m.total),
    value: m.total,
    detail: plural(m.count, "receipt"),
    href: sliceHref({ from: range.from, to: range.to, merchant: m.name }),
  }));
  const restRow: BarRow | null = rest
    ? {
        key: "rest",
        label: top.length ? "Everything else" : "No merchant name",
        amount: money(rest.total),
        value: rest.total,
        detail: plural(rest.count, "receipt"),
      }
    : null;
  return (
    <ChartCard description="Same name, ignoring case and spaces" title="Top merchants">
      {rows.length === 0 && !restRow ? null : rows.length === 1 && !restRow ? (
        <p className="text-sm">
          All from {top[0]!.name}: {money(top[0]!.total)}.
        </p>
      ) : (
        <BarList label="Spend by merchant" rows={restRow ? [...rows, restRow] : rows} />
      )}
    </ChartCard>
  );
}

function LargestCard({ spend, money }: { spend: CurrencySpend; money: (v: number) => string }) {
  return (
    <ChartCard title="Largest receipts">
      <ol className="flex flex-col divide-y divide-border">
        {spend.largest.map((r) => (
          <li key={r.id}>
            <Link
              className="flex items-baseline justify-between gap-3 rounded-md px-2 py-2 text-sm outline-none hover:bg-wash-subtle focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
              href={`/app/receipts/${r.id}`}
            >
              <span className="min-w-0">
                <span className="block truncate">{r.merchant ?? "No merchant name"}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(r.date)}
                  {r.usesUploadDate ? " (upload date)" : ""}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums">{money(r.total)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </ChartCard>
  );
}

function WeekdayCard({ spend, money }: { spend: CurrencySpend; money: (v: number) => string }) {
  const max = Math.max(...spend.weekdays.map((d) => d.total));
  const top = spend.weekdays.reduce((a, b) => (b.total > a.total ? b : a));
  return (
    <ChartCard
      description="Which days of the week the receipts are dated"
      summary={`Most spent on ${formatWeekday(top.isoDay)}s: ${money(top.total)} across ${plural(top.count, "receipt")}.`}
      title="By day of the week"
    >
      <ol className="grid grid-cols-7 gap-1.5">
        {spend.weekdays.map((d) => (
          <li className="flex min-w-0 flex-col items-center gap-1" key={d.isoDay}>
            <span
              aria-hidden="true"
              className="h-10 w-full rounded-md border border-border"
              style={{
                background: `color-mix(in oklab, var(--primary) ${max > 0 ? Math.round(8 + (d.total / max) * 72) : 0}%, transparent)`,
              }}
            />
            <span className="text-2xs text-muted-foreground">
              <abbr className="no-underline" title={formatWeekday(d.isoDay)}>
                {formatWeekday(d.isoDay).slice(0, 3)}
              </abbr>
            </span>
            <span className="sr-only">
              {formatWeekday(d.isoDay)}: {money(d.total)}, {plural(d.count, "receipt")}
            </span>
          </li>
        ))}
      </ol>
      <DataTable
        caption="Spend by day of the week"
        columns={[
          {
            header: "Day",
            cell: (d: CurrencySpend["weekdays"][number]) => formatWeekday(d.isoDay),
          },
          { header: "Spent", cell: (d) => money(d.total), numeric: true },
          { header: "Receipts", cell: (d) => d.count, numeric: true },
        ]}
        rows={spend.weekdays}
      />
    </ChartCard>
  );
}
