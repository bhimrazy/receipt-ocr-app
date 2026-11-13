import { BS_ANCHOR_AD, BS_FIRST_YEAR, BS_MONTH_DAYS } from "./bs-table";

/** A Bikram Sambat day. `month` is 1 (Baisakh) to 12 (Chaitra). */
export type BsDate = { year: number; month: number; day: number };

/** Display spellings, romanised; input accepts the variants in `resolve.ts`. */
export const BS_MONTH_NAMES = [
  "Baisakh",
  "Jestha",
  "Asar",
  "Shrawan",
  "Bhadra",
  "Asoj",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a real `YYYY-MM-DD`, else null. */
export function isoToDayNumber(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time / DAY_MS;
}

export function dayNumberToIso(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

const ANCHOR = isoToDayNumber(BS_ANCHOR_AD)!;

/** Day number of 1 Baisakh of each table year, plus one past the last day. */
const YEAR_STARTS: readonly number[] = BS_MONTH_DAYS.reduce<number[]>(
  (starts, months) => [...starts, starts.at(-1)! + months.reduce((sum, days) => sum + days, 0)],
  [ANCHOR],
);

/** Days in a BS month, or null outside the table. */
export function daysInBsMonth(year: number, month: number): number | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return BS_MONTH_DAYS[year - BS_FIRST_YEAR]?.[month - 1] ?? null;
}

/** The AD day (`YYYY-MM-DD`) of a BS date, or null when it isn't a day in the table. */
export function bsToAd({ year, month, day }: BsDate): string | null {
  const length = daysInBsMonth(year, month);
  if (length === null || !Number.isInteger(day) || day < 1 || day > length) return null;
  let dayNumber = YEAR_STARTS[year - BS_FIRST_YEAR]!;
  for (let m = 1; m < month; m++) dayNumber += daysInBsMonth(year, m)!;
  return dayNumberToIso(dayNumber + day - 1);
}

/** The BS date of an AD day (`YYYY-MM-DD`), or null when it isn't a real day or is outside the table. */
export function adToBs(iso: string): BsDate | null {
  const dayNumber = isoToDayNumber(iso);
  if (dayNumber === null || dayNumber < ANCHOR || dayNumber >= YEAR_STARTS.at(-1)!) return null;
  let index = 0;
  while (YEAR_STARTS[index + 1]! <= dayNumber) index++;
  let offset = dayNumber - YEAR_STARTS[index]!;
  const months = BS_MONTH_DAYS[index]!;
  let month = 0;
  while (offset >= months[month]!) offset -= months[month++]!;
  return { year: BS_FIRST_YEAR + index, month: month + 1, day: offset + 1 };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2080-04-09". */
export const bsIso = ({ year, month, day }: BsDate) => `${year}-${pad(month)}-${pad(day)}`;

/** "2080.04.09": the form Nepal's IRD billing API takes, and what the CSV writes. */
export const bsDotted = ({ year, month, day }: BsDate) => `${year}.${pad(month)}.${pad(day)}`;

/** "9 Shrawan 2080". */
export const formatBs = ({ year, month, day }: BsDate) =>
  `${day} ${BS_MONTH_NAMES[month - 1]} ${year}`;

/** Devanagari digits (U+0966 to U+096F) as ASCII. */
export const asciiDigits = (text: string) =>
  text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));

/**
 * A typed BS date, year first (`2080-04-09`, `2080/4/9`, `२०८०.०४.०९`), or null when it isn't a day in the table.
 * For the editor; printed receipt text goes through the resolver, which knows more orders.
 */
export function parseBsInput(text: string): BsDate | null {
  const match = /^\s*(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*$/.exec(asciiDigits(text));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  return bsToAd({ year, month, day }) ? { year, month, day } : null;
}

/** First and last AD day of Nepal fiscal year `startYear`/`startYear + 1` (1 Shrawan to the end of Asar). */
export function fiscalYearRange(startYear: number): { from: string; to: string } | null {
  const from = bsToAd({ year: startYear, month: 4, day: 1 });
  const nextStart = bsToAd({ year: startYear + 1, month: 4, day: 1 });
  if (!from || !nextStart) return null;
  return { from, to: dayNumberToIso(isoToDayNumber(nextStart)! - 1) };
}
