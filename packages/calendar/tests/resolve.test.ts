import { describe, expect, it } from "vitest";
import {
  printedBsDate,
  resolveReceiptDate,
  type DateEvidence,
  type ResolvedDate,
} from "../src/resolve";

const uploadDay = "2026-11-12";
const resolve = (evidence: Partial<DateEvidence>) => resolveReceiptDate({ uploadDay, ...evidence });
const date = (text: string, label: string | null = null, role = "transaction") => ({
  text,
  label,
  role,
});
const result = (
  value: string | null,
  calendar: ResolvedDate["calendar"],
  reasons: ResolvedDate["reasons"] = [],
): ResolvedDate => ({ date: value, calendar, reasons });

// Rows of the decision table in docs/reviews/2026-11-12-extraction-review.md, section 2.
describe("resolveReceiptDate", () => {
  it.each<[string, Partial<DateEvidence>, ResolvedDate]>([
    [
      "1: BS and AD year-first under one label agree",
      { dates: [date("2071/11/25", "Date"), date("2015/03/09", "Date")], uploadDay: "2015-03-10" },
      result("2015-03-09", "bikram-sambat"),
    ],
    [
      "2: the Miti settles an AD date's order (US order)",
      { dates: [date("10/07/2023", "Date"), date("20/06/2080", "Miti")], uploadDay: "2023-10-08" },
      result("2023-10-07", "bikram-sambat"),
    ],
    [
      "3: BS alone, year last, is day first",
      { dates: [date("09/04/2080")], uploadDay: "2023-07-26" },
      result("2023-07-25", "bikram-sambat"),
    ],
    [
      "4: Devanagari digits",
      { dates: [date("२०८१/०७/१५")] },
      result("2024-10-31", "bikram-sambat"),
    ],
    [
      "4: a two-digit BS year",
      { dates: [date("15/07/81")] },
      result("2024-10-31", "bikram-sambat"),
    ],
    [
      "5: a Nepali month name",
      { dates: [date("१५ कार्तिक २०८१")] },
      result("2024-10-31", "bikram-sambat"),
    ],
    [
      "5: a romanised month name",
      { dates: [date("15 Kartik 2081")] },
      result("2024-10-31", "bikram-sambat"),
    ],
    [
      "6: AD with a day over 12 has one order",
      { dates: [date("25/07/2025")] },
      result("2025-07-25", "gregory"),
    ],
    [
      "6: an English month name",
      { dates: [date("Jul 25, 2025")] },
      result("2025-07-25", "gregory"),
    ],
    [
      "7: both orders valid, the model's reading breaks the tie",
      { dates: [date("05/06/2025")], modelReading: "2025-05-06" },
      result("2025-05-06", "gregory", ["date_ambiguous"]),
    ],
    [
      "7: both orders valid, no model reading: day first",
      { dates: [date("05/06/2025")] },
      result("2025-06-05", "gregory", ["date_ambiguous"]),
    ],
    [
      "8: AD and Miti disagree on an NPR bill: BS wins",
      { dates: [date("25/07/2025", "Date"), date("01/04/2082", "Miti")], currency: "NPR" },
      result("2025-07-17", "bikram-sambat", ["date_conflict"]),
    ],
    [
      "8: AD and Miti disagree in another currency: AD wins",
      { dates: [date("25/07/2025", "Date"), date("01/04/2082", "Miti")], currency: "USD" },
      result("2025-07-25", "bikram-sambat", ["date_conflict"]),
    ],
    [
      "8: the Miti is out of bounds: the AD date stands",
      { dates: [date("25/07/2025", "Date"), date("01/04/2089", "Miti")], currency: "NPR" },
      result("2025-07-25", "bikram-sambat", ["date_conflict"]),
    ],
    [
      "9: a Miti label on an AD year: the year wins",
      { dates: [date("2025-07-25", "मिति")] },
      result("2025-07-25", "gregory", ["date_conflict"]),
    ],
    [
      "9: an A.D. label on a BS year",
      { dates: [date("2082-04-10", "A.D.")] },
      result("2025-07-26", "bikram-sambat", ["date_conflict"]),
    ],
    [
      "9: a B.S. label that agrees",
      { dates: [date("2082-04-10", "Date (B.S.)")] },
      result("2025-07-26", "bikram-sambat"),
    ],
    [
      "10: a fiscal year is not a date",
      { dates: [date("2081/82", "FY"), date("2082-01-10", "Miti")] },
      result("2025-04-23", "bikram-sambat"),
    ],
    [
      "10: a date outside the bill number's fiscal year",
      { dates: [date("2082-04-10")], fiscalYearHints: ["SI-0042-80/81"] },
      result("2025-07-26", "bikram-sambat", ["date_conflict"]),
    ],
    [
      "10: a date inside the bill number's fiscal year",
      { dates: [date("2082-04-10")], fiscalYearHints: ["SI-0042-082/83"] },
      result("2025-07-26", "bikram-sambat"),
    ],
    [
      "11: day 32 in a 32-day month",
      { dates: [date("32/02/2081")] },
      result("2024-06-14", "bikram-sambat"),
    ],
    [
      "11: day 32 in a 31-day month",
      { dates: [date("32/03/2081")] },
      result(null, null, ["date_implausible"]),
    ],
    [
      "12: a BS year after the upload",
      { dates: [date("2084-01-01")] },
      result(null, null, ["date_implausible"]),
    ],
    [
      "12: a year that is neither calendar",
      { dates: [date("2040-01-01")] },
      result(null, null, ["date_implausible"]),
    ],
    ["12: before 2000", { dates: [date("31/12/1999")] }, result(null, null, ["date_implausible"])],
    [
      "12: an AD date after the upload day + 1",
      { dates: [date("2026-11-14")] },
      result(null, null, ["date_implausible"]),
    ],
    [
      "12: the upload day + 1 is allowed (time zones)",
      { dates: [date("2026-11-13")] },
      result("2026-11-13", "gregory"),
    ],
    [
      "13: unparseable text",
      { dates: [date("yesterday")] },
      result(null, null, ["date_implausible"]),
    ],
    [
      "14: more than 3 years before the upload",
      { dates: [date("2023-11-11")] },
      result("2023-11-11", "gregory", ["date_ambiguous"]),
    ],
    ["15: nothing printed", { dates: [], modelReading: null }, result(null, null)],
    [
      "15: only a due date",
      { dates: [date("2026-01-10", "Due date", "other")] },
      result(null, null),
    ],
    [
      "16: before v3, the model's AD reading, calendar unknown",
      { modelReading: "2025-07-25" },
      result("2025-07-25", null),
    ],
    [
      "16: before v3, a BS date the model returned as AD is converted",
      { modelReading: "2082-04-10" },
      result("2025-07-26", "bikram-sambat"),
    ],
    [
      "16: before v3, a future reading is implausible",
      { modelReading: "2027-01-01" },
      result(null, null, ["date_implausible"]),
    ],
  ])("%s", (_name, evidence, expected) => {
    expect(resolve(evidence)).toEqual(expected);
  });

  it("flags a date in a projected BS year", () => {
    expect(resolve({ dates: [date("2084-01-05")], uploadDay: "2027-04-20" })).toEqual(
      result("2027-04-18", "bikram-sambat", ["date_ambiguous"]),
    );
  });

  it("reads a date printed after or before a time", () => {
    for (const text of ["10:30 05/06/2024", "05/06/2024 10:30", "05/06/2024 10:30:15 PM"]) {
      expect(resolve({ dates: [date(text)], uploadDay: "2024-06-10" })).toEqual(
        result("2024-06-05", "gregory", ["date_ambiguous"]),
      );
    }
    expect(resolve({ dates: [date("10:30 2080-04-09")], uploadDay: "2023-07-26" })).toEqual(
      result("2023-07-25", "bikram-sambat"),
    );
  });

  it("flags a BS receipt whose date is past the end of the table, without converting it", () => {
    expect(
      resolve({
        dates: [date("05/01/2034", "Date"), date("01/01/2091", "Miti")],
        uploadDay: "2034-01-06",
      }),
    ).toEqual(result("2034-01-05", "bikram-sambat", ["date_ambiguous", "date_conflict"]));
  });

  it("never throws on junk text", () => {
    for (const text of ["", "////", "99/99/99", "३२ फागुन", "Date:", "1".repeat(40), "a/b/c"]) {
      expect(() => resolve({ dates: [date(text)] })).not.toThrow();
    }
  });
});

describe("printedBsDate", () => {
  it("gives the BS date only for receipts that printed BS", () => {
    expect(printedBsDate("2023-07-25", "bikram-sambat")).toEqual({ year: 2080, month: 4, day: 9 });
    expect(printedBsDate("2023-07-25", "gregory")).toBeNull();
    expect(printedBsDate("2023-07-25", null)).toBeNull();
    expect(printedBsDate(null, "bikram-sambat")).toBeNull();
  });
});
