import {
  adToBs,
  asciiDigits,
  type BsDate,
  bsToAd,
  dayNumberToIso,
  fiscalYearRange,
  isoToDayNumber,
} from "./bs";
import { BS_FIRST_YEAR, BS_LAST_YEAR, BS_OFFICIAL_THROUGH } from "./bs-table";

/** The calendar a receipt printed its date in: Unicode `u-ca` identifiers, `bikram-sambat` being ours. */
export const RECEIPT_CALENDARS = ["gregory", "bikram-sambat"] as const;
export type ReceiptCalendar = (typeof RECEIPT_CALENDARS)[number];

/** The BS date shown beside a receipt's AD date: only for a receipt that printed BS. */
export function printedBsDate(date: string | null, calendar: string | null): BsDate | null {
  return date && calendar === "bikram-sambat" ? adToBs(date) : null;
}

export type DateReason = "date_ambiguous" | "date_conflict" | "date_implausible";

/** A date as the model transcribed it (`dates[]` in the extraction). Every field but `text` is a hint. */
export type PrintedDate = {
  text: string;
  label?: string | null;
  calendar?: string | null;
  /** `other` for due, delivery, expiry or print dates: never the receipt's date. */
  role?: string | null;
};

export type DateEvidence = {
  /** Every printed date; absent when the extraction carries only `modelReading`. */
  dates?: readonly PrintedDate[] | null;
  /** The model's own AD reading, `YYYY-MM-DD`: a tie-break for day/month order, and the whole evidence before v3. */
  modelReading?: string | null;
  /** The UTC day the receipt was uploaded, `YYYY-MM-DD`. A date may be at most a day after it. */
  uploadDay: string;
  currency?: string | null;
  /** Other printed text that may carry a Nepal fiscal year (`SI-0042-81/82`): the bill number. */
  fiscalYearHints?: readonly (string | null | undefined)[];
};

export type ResolvedDate = {
  /** The AD day, `YYYY-MM-DD`, or null when nothing printed is a plausible date. */
  date: string | null;
  /** Null when no date was read, or when only the model's AD reading (no printed text) was available. */
  calendar: ReceiptCalendar | null;
  reasons: DateReason[];
};

const EARLIEST = "2000-01-01";
/** A plausible date this much older than the upload is kept, but flagged. */
const OLD_AFTER_YEARS = 3;

type Calendar = "ad" | "bs";
type Reading = { iso: string; calendar: Calendar };

const ENGLISH_MONTHS: Record<string, number> = {};
for (const [index, name] of [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
].entries()) {
  ENGLISH_MONTHS[name] = index + 1;
  ENGLISH_MONTHS[name.slice(0, 3)] = index + 1;
}
ENGLISH_MONTHS.sept = 9;

/** Romanised and Devanagari spellings seen on receipts and in Nepali sources, by month number. */
const BS_MONTH_SPELLINGS: readonly string[][] = [
  ["baisakh", "baishakh", "baisak", "baishak", "vaisakh", "vaishakh", "बैशाख", "वैशाख", "बैसाख"],
  ["jestha", "jeth", "jeshtha", "jyeshtha", "jesth", "जेठ", "जेष्ठ", "ज्येष्ठ"],
  ["asar", "ashar", "ashadh", "asadh", "ashad", "aasar", "असार", "आषाढ", "असाढ"],
  ["shrawan", "shravan", "srawan", "saun", "saaun", "sawan", "साउन", "श्रावण", "साऊन"],
  ["bhadra", "bhadau", "bhado", "भदौ", "भाद्र"],
  ["asoj", "ashoj", "ashwin", "aswin", "असोज", "आश्विन"],
  ["kartik", "kattik", "कात्तिक", "कार्तिक"],
  ["mangsir", "mansir", "mangshir", "marga", "मंसिर", "मङ्सिर", "मार्गशीर्ष"],
  ["poush", "paush", "push", "pus", "पुष", "पौष", "पुस"],
  ["magh", "maagh", "माघ"],
  ["falgun", "fagun", "phalgun", "phagun", "फागुन", "फाल्गुन"],
  ["chaitra", "chait", "चैत", "चैत्र"],
];
const BS_MONTHS: Record<string, number> = {};
BS_MONTH_SPELLINGS.forEach((spellings, index) => {
  for (const spelling of spellings) BS_MONTHS[spelling] = index + 1;
});

const BS_LABELS = new Set(["miti", "मिति", "विसं", "बिसं", "विस", "बिस", "bs", "nepali"]);
const AD_LABELS = new Set(["ad", "ईसं", "ईस", "english", "gregorian"]);

const normalise = (text: string) => asciiDigits(text.normalize("NFKC").toLowerCase());
/** Latin or Devanagari words (digits excluded); dots dropped first so `B.S.` and `वि.सं.` read as one word. */
const words = (text: string) =>
  normalise(text)
    .replace(/\./g, "")
    .match(/[a-z]+|[ऀ-॥॰-ॿ]+/g) ?? [];

function labelCalendar(...texts: (string | null | undefined)[]): Calendar | null {
  const found = new Set<Calendar>();
  for (const word of texts.flatMap((text) => (text ? words(text) : []))) {
    if (BS_LABELS.has(word)) found.add("bs");
    if (AD_LABELS.has(word)) found.add("ad");
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** 2- and 3-digit years are 20yy (`81`, `081` → 2081); 4 digits as printed. */
function fullYear(digits: string): number | null {
  if (digits.length === 4) return Number(digits);
  if (digits.length === 2 || digits.length === 3) return 2000 + (Number(digits) % 100);
  return null;
}

/**
 * The fiscal year a token like `2081/82`, `081/82` or `80/81` names (the second part is the first plus one), as its
 * BS start year. Two-part tokens only, so a date's `05/06/2024` never matches.
 */
function fiscalYears(text: string): number[] {
  const years: number[] = [];
  for (const match of normalise(text).matchAll(/(?<![\d/])(\d{2,4})\s*\/\s*(\d{2,3})(?![\d/])/g)) {
    const start = fullYear(match[1]!);
    const end = Number(match[2]!);
    if (start === null || (start + 1) % 100 !== end % 100) continue;
    if (start >= BS_FIRST_YEAR && start < BS_LAST_YEAR) years.push(start);
  }
  return years;
}

const isFiscalYearOnly = (text: string) =>
  /^\D*\d{2,4}\s*\/\s*\d{2,3}\D*$/.test(normalise(text)) && fiscalYears(text).length > 0;

type Bounds = { earliest: string; latest: string };

function adReading(year: number, month: number, day: number, bounds: Bounds): Reading | null {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (isoToDayNumber(iso) === null || iso < bounds.earliest || iso > bounds.latest) return null;
  return { iso, calendar: "ad" };
}

function bsReading(year: number, month: number, day: number, bounds: Bounds): Reading | null {
  const iso = bsToAd({ year, month, day });
  if (iso === null || iso < bounds.earliest || iso > bounds.latest) return null;
  return { iso, calendar: "bs" };
}

type Parsed = {
  readings: Reading[];
  /** The calendar the printed text claims, by label, month name or year, even when no reading is valid. */
  claimed: Calendar | null;
  /** The label (or a marker in the text) names the other calendar than the readings. */
  labelConflict: boolean;
};

const valid = (readings: (Reading | null)[]) => readings.filter((r): r is Reading => r !== null);

/**
 * Every plausible reading of one printed date, preferred first. The year settles the calendar: within the bounds an
 * AD year (2000 to the upload year) and a BS year (2056 on) can't overlap. Year-first is YMD; year-last is DMY or
 * MDY in AD and DMY in BS (no BS receipt we have prints MDY). A month name settles its calendar and the order.
 */
function parsePrinted(text: string, label: string | null | undefined, bounds: Bounds): Parsed {
  // Times (10:30, 10:30:15 pm) go first, so their digits are never read as a day or a year.
  const normalised = normalise(text).replace(/\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?/g, " ");
  const named = words(text);
  const bsMonth = named.map((word) => BS_MONTHS[word]).find((month) => month !== undefined);
  const adMonth = named.map((word) => ENGLISH_MONTHS[word]).find((month) => month !== undefined);
  let readings: Reading[] = [];
  let year: number | null = null;

  if (bsMonth !== undefined || adMonth !== undefined) {
    const numbers = normalised.match(/\d+/g) ?? [];
    const yearToken =
      numbers.find((n) => n.length >= 3) ?? (numbers.length >= 2 ? numbers.at(-1) : undefined);
    const dayToken = numbers.find((n) => n !== yearToken && n.length <= 2);
    year = yearToken ? fullYear(yearToken) : null;
    if (year !== null && dayToken && (bsMonth === undefined) !== (adMonth === undefined)) {
      readings = valid([
        bsMonth !== undefined
          ? bsReading(year, bsMonth, Number(dayToken), bounds)
          : adReading(year, adMonth!, Number(dayToken), bounds),
      ]);
    }
  } else {
    const match = /(?<!\d)(\d{1,4})\s*[/\-.\s]\s*(\d{1,2})\s*[/\-.\s]\s*(\d{1,4})(?!\d)/.exec(
      normalised,
    );
    if (match) {
      const [a, b, c] = [match[1]!, match[2]!, match[3]!];
      const [na, nb, nc] = [Number(a), Number(b), Number(c)];
      year = fullYear(a.length >= 3 ? a : c);
      if (year !== null) {
        readings =
          a.length >= 3
            ? valid([adReading(year, nb, nc, bounds), bsReading(year, nb, nc, bounds)])
            : valid([
                adReading(year, nb, na, bounds),
                adReading(year, na, nb, bounds),
                bsReading(year, nb, na, bounds),
              ]);
      }
    }
  }

  readings = readings.filter((r, index) => readings.findIndex((o) => o.iso === r.iso) === index);
  const marked = labelCalendar(label, text);
  const byText: Calendar | null =
    bsMonth !== undefined
      ? "bs"
      : adMonth !== undefined
        ? "ad"
        : year !== null && year >= BS_FIRST_YEAR
          ? "bs"
          : null;
  return {
    readings,
    claimed: readings[0]?.calendar ?? byText ?? marked,
    labelConflict:
      marked !== null && readings.length > 0 && readings.every((r) => r.calendar !== marked),
  };
}

/** Of several AD readings, the model's if it is one of them, else the first (day first). */
const pick = (readings: Reading[], modelReading: string | null | undefined) =>
  readings.find((r) => r.iso === modelReading?.trim()) ?? readings[0]!;

function shiftYears(iso: string, years: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

/**
 * One AD day, its calendar and the date review reasons from what a receipt printed. Pure. Never throws except on a
 * malformed `uploadDay`. The rules: docs/architecture/dates.md#resolving-a-printed-date.
 */
export function resolveReceiptDate(evidence: DateEvidence): ResolvedDate {
  const latestDay = isoToDayNumber(evidence.uploadDay);
  if (latestDay === null) throw new Error("uploadDay must be YYYY-MM-DD");
  const bounds = { earliest: EARLIEST, latest: dayNumberToIso(latestDay + 1) };

  const fiscal = [
    ...new Set(
      [...(evidence.dates ?? []).map((d) => d.text), ...(evidence.fiscalYearHints ?? [])]
        .filter((text): text is string => typeof text === "string")
        .flatMap(fiscalYears),
    ),
  ];
  const printed = (evidence.dates ?? []).filter(
    (d) => d.role !== "other" && typeof d.text === "string" && !isFiscalYearOnly(d.text),
  );
  const fromModel = printed.length === 0;
  const parsed = fromModel
    ? evidence.modelReading?.trim()
      ? [parsePrinted(evidence.modelReading, null, bounds)]
      : []
    : printed.map((d) => parsePrinted(d.text, d.label, bounds));
  if (parsed.length === 0) return { date: null, calendar: null, reasons: [] };

  const reasons = new Set<DateReason>();
  if (parsed.some((p) => p.labelConflict)) reasons.add("date_conflict");
  const first = (calendar: Calendar) =>
    parsed.find((p) => p.readings.some((r) => r.calendar === calendar))?.readings ?? [];
  const ad = first("ad");
  const bs = first("bs");
  const invalidBs = parsed.some((p) => p.readings.length === 0 && p.claimed === "bs");

  let chosen: string;
  if (ad.length === 0 && bs.length === 0) {
    return { date: null, calendar: null, reasons: ["date_implausible"] };
  } else if (bs.length === 0) {
    chosen = pick(ad, evidence.modelReading).iso;
    if (ad.length > 1) reasons.add("date_ambiguous");
    if (invalidBs) reasons.add("date_conflict");
  } else if (ad.length === 0) {
    chosen = bs[0]!.iso;
  } else {
    const agreed = ad.find((a) => bs.some((b) => b.iso === a.iso));
    if (agreed) {
      chosen = agreed.iso;
    } else {
      reasons.add("date_conflict");
      chosen =
        evidence.currency?.trim().toUpperCase() === "NPR"
          ? bs[0]!.iso
          : pick(ad, evidence.modelReading).iso;
    }
  }

  const printedBs = bs.length > 0 || invalidBs;
  const inFiscalYear = (year: number) => {
    const range = fiscalYearRange(year);
    return range !== null && chosen >= range.from && chosen <= range.to;
  };
  if (fiscal.length > 0 && !fiscal.some(inFiscalYear)) reasons.add("date_conflict");
  if (chosen < shiftYears(evidence.uploadDay, -OLD_AFTER_YEARS)) reasons.add("date_ambiguous");
  // Past the table there is no BS day to show (display and CSV fall back to AD): flag it like a projected year.
  const bsDay = adToBs(chosen);
  if (printedBs && (bsDay === null || bsDay.year > BS_OFFICIAL_THROUGH))
    reasons.add("date_ambiguous");

  const calendar: ReceiptCalendar | null = printedBs
    ? "bikram-sambat"
    : fromModel
      ? null
      : "gregory";
  return { date: chosen, calendar, reasons: [...reasons].sort() };
}
