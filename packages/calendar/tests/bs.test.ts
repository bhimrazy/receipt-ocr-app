import { describe, expect, it } from "vitest";
import {
  adToBs,
  bsDotted,
  bsIso,
  bsToAd,
  dayNumberToIso,
  daysInBsMonth,
  fiscalYearRange,
  formatBs,
  isoToDayNumber,
  parseBsInput,
} from "../src/bs";
import {
  BS_ANCHOR_AD,
  BS_FIRST_YEAR,
  BS_LAST_YEAR,
  BS_MONTH_DAYS,
  BS_OFFICIAL_THROUGH,
} from "../src/bs-table";

const bs = (text: string) => {
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  return { year, month, day };
};

describe("BS month table", () => {
  it("has 12 months of 29 to 32 days and years of 365 or 366 days", () => {
    for (const months of BS_MONTH_DAYS) {
      expect(months).toHaveLength(12);
      for (const days of months) expect(days).toBeGreaterThanOrEqual(29);
      for (const days of months) expect(days).toBeLessThanOrEqual(32);
      expect([365, 366]).toContain(months.reduce((sum, days) => sum + days, 0));
    }
  });

  it("covers every day a receipt may carry, from 2000-01-01", () => {
    expect(adToBs("2000-01-01")).toEqual({ year: 2056, month: 9, day: 17 });
    expect(adToBs(BS_ANCHOR_AD)).toEqual({ year: BS_FIRST_YEAR, month: 1, day: 1 });
    expect(adToBs("1999-04-13")).toBeNull();
  });

  it("is approved through the BS year that holds today (update it when the next year is approved)", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(adToBs(today)!.year).toBeLessThanOrEqual(BS_OFFICIAL_THROUGH);
  });
});

describe("bsToAd and adToBs", () => {
  it("puts 1 Baisakh 2070 to 2083 on the published New Year days", () => {
    const newYears: Record<number, string> = {
      2070: "2013-04-14",
      2071: "2014-04-14",
      2072: "2015-04-14",
      2073: "2016-04-13",
      2074: "2017-04-14",
      2075: "2018-04-14",
      2076: "2019-04-14",
      2077: "2020-04-13",
      2078: "2021-04-14",
      2079: "2022-04-14",
      2080: "2023-04-14",
      2081: "2024-04-13",
      2082: "2025-04-14",
      2083: "2026-04-14",
    };
    for (const [year, ad] of Object.entries(newYears)) {
      expect(bsToAd({ year: Number(year), month: 1, day: 1 })).toBe(ad);
    }
  });

  it.each([
    // The owner's receipts (dual-calendar plan, section 7.3).
    ["2080-06-20", "2023-10-07"],
    ["2080-10-15", "2024-01-29"],
    ["2080-04-09", "2023-07-25"],
    ["2080-08-09", "2023-11-25"],
    ["2078-12-26", "2022-04-09"],
    ["2071-11-25", "2015-03-09"],
    // A sample of medic/bikram-sambat's reference pairs (test-data/toGreg.json at aeaa7b8).
    ["2056-10-25", "2000-02-08"],
    ["2057-08-19", "2000-12-04"],
    ["2058-06-14", "2001-09-30"],
    ["2059-04-11", "2002-07-27"],
    ["2060-02-09", "2003-05-23"],
    ["2060-12-05", "2004-03-18"],
    ["2061-09-28", "2005-01-12"],
    ["2062-07-22", "2005-11-08"],
    ["2063-05-19", "2006-09-04"],
    ["2064-03-17", "2007-07-01"],
    ["2065-01-14", "2008-04-26"],
    ["2065-11-09", "2009-02-20"],
    ["2066-09-02", "2009-12-17"],
    ["2067-06-27", "2010-10-13"],
    ["2068-04-24", "2011-08-09"],
    ["2069-02-22", "2012-06-04"],
    ["2069-12-18", "2013-03-31"],
    ["2070-10-11", "2014-01-25"],
    ["2071-08-05", "2014-11-21"],
    ["2072-05-31", "2015-09-17"],
    ["2073-03-29", "2016-07-13"],
    ["2074-01-26", "2017-05-09"],
    ["2074-11-21", "2018-03-05"],
    ["2075-09-15", "2018-12-30"],
    ["2076-07-09", "2019-10-26"],
    ["2077-05-05", "2020-08-21"],
    ["2078-03-03", "2021-06-17"],
    ["2078-12-30", "2022-04-13"],
    ["2079-10-24", "2023-02-07"],
    ["2080-08-18", "2023-12-04"],
    ["2081-06-13", "2024-09-29"],
    ["2082-04-10", "2025-07-26"],
    ["2083-02-08", "2026-05-22"],
    ["2083-12-04", "2027-03-18"],
  ])("BS %s is AD %s", (bsText, ad) => {
    expect(bsToAd(bs(bsText))).toBe(ad);
    expect(adToBs(ad)).toEqual(bs(bsText));
  });

  it("round-trips every day of the table, one AD day per BS day, in order", () => {
    const first = isoToDayNumber(BS_ANCHOR_AD)!;
    let previous = first - 1;
    let days = 0;
    for (let year = BS_FIRST_YEAR; year <= BS_LAST_YEAR; year++) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= daysInBsMonth(year, month)!; day++) {
          const ad = bsToAd({ year, month, day })!;
          const dayNumber = isoToDayNumber(ad)!;
          expect(dayNumber).toBe(previous + 1);
          expect(adToBs(ad)).toEqual({ year, month, day });
          previous = dayNumber;
          days++;
        }
      }
    }
    expect(adToBs(dayNumberToIso(previous + 1))).toBeNull();
    expect(days).toBe(previous - first + 1);
  });

  it("rejects days that aren't in the table", () => {
    expect(bsToAd({ year: 2081, month: 3, day: 32 })).toBeNull(); // Asar 2081 has 31
    expect(bsToAd({ year: 2081, month: 2, day: 32 })).toBe("2024-06-14"); // Jestha 2081 has 32
    expect(bsToAd({ year: 2080, month: 13, day: 1 })).toBeNull();
    expect(bsToAd({ year: 2080, month: 1, day: 0 })).toBeNull();
    expect(bsToAd({ year: 2055, month: 1, day: 1 })).toBeNull();
    expect(bsToAd({ year: BS_LAST_YEAR + 1, month: 1, day: 1 })).toBeNull();
    expect(adToBs("2026-02-30")).toBeNull();
  });
});

describe("formatting and input", () => {
  it("formats a BS date three ways", () => {
    const date = { year: 2080, month: 4, day: 9 };
    expect(formatBs(date)).toBe("9 Shrawan 2080");
    expect(bsIso(date)).toBe("2080-04-09");
    expect(bsDotted(date)).toBe("2080.04.09");
  });

  it("reads typed BS dates year first, with Devanagari digits", () => {
    expect(parseBsInput("2080-04-09")).toEqual({ year: 2080, month: 4, day: 9 });
    expect(parseBsInput(" 2080/4/9 ")).toEqual({ year: 2080, month: 4, day: 9 });
    expect(parseBsInput("२०८०.०४.०९")).toEqual({ year: 2080, month: 4, day: 9 });
    expect(parseBsInput("2081-03-32")).toBeNull();
    expect(parseBsInput("09/04/2080")).toBeNull();
    expect(parseBsInput("")).toBeNull();
  });
});

describe("fiscalYearRange", () => {
  it("runs from 1 Shrawan to the end of Asar", () => {
    expect(fiscalYearRange(2082)).toEqual({ from: "2025-07-17", to: "2026-07-16" });
    expect(fiscalYearRange(2083)).toEqual({ from: "2026-07-17", to: "2027-07-16" });
    expect(fiscalYearRange(BS_LAST_YEAR)).toBeNull();
  });
});
