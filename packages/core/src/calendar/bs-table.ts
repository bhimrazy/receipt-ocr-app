/**
 * Bikram Sambat month lengths, BS 2056 to 2090. BS has no formula: each year's months (29 to 32 days) come from
 * the almanac the Nepal Panchang Nirnayak Bikas Samiti approves, one year ahead. Receipts are dated from 2000-01-01
 * (Poush 2056) on, so earlier years are left out.
 *
 * Provenance, checked 2026-11-12. Month lengths are facts; these three tables were diffed year by year:
 * - subeshb1/Nepali-Date `src/date-config.ts` at f14e039 (MIT, npm `nepali-date-converter`)
 * - medic/bikram-sambat `test-data/daysInMonth.json` at aeaa7b8 (Apache-2.0)
 * - amitgaru/nepali-datetime `nepali_datetime/data/calendar_bs.csv` at 83bb3b2 (PyPI `nepali-datetime`)
 * All three agree on every row except 2062 and 2087, where amitgaru is the outlier; those rows take the other two.
 * All three put 1 Baisakh 2056 on 1999-04-14, the anchor below. medic's 10,227 BS-to-AD reference pairs for 2056 to
 * 2083 match this table (the tests carry a sample).
 *
 * Rows after `BS_OFFICIAL_THROUGH` are projections and have changed after release before (2081 to 2083 were each
 * corrected in libraries). Yearly update: when the Samiti approves year N+1, diff its row against two published
 * almanacs, replace the row and bump `BS_OFFICIAL_THROUGH`. A test fails once today is past that year.
 */

export const BS_FIRST_YEAR = 2056;
/** The last year whose months the Samiti has approved. Later rows are projections. */
export const BS_OFFICIAL_THROUGH = 2083;
/** 1 Baisakh `BS_FIRST_YEAR`, in AD. */
export const BS_ANCHOR_AD = "1999-04-14";

/** Days in each month, Baisakh to Chaitra, one row per year from `BS_FIRST_YEAR`. Comment: year (days). */
export const BS_MONTH_DAYS: readonly (readonly number[])[] = [
  [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30], // 2056 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2057 (366)
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2058 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2059 (365)
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2060 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2061 (366)
  [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31], // 2062 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2063 (365)
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2064 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2065 (366)
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31], // 2066 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2067 (365)
  [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2068 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2069 (366)
  [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30], // 2070 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2071 (365)
  [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 2072 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 2073 (366)
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2074 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2075 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2076 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2077 (366)
  [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], // 2078 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2079 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 2080 (365)
  [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 2081 (366)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2082 (365)
  [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 2083 (365)
  [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30], // 2084 (365) projected
  [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30], // 2085 (366) projected
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], // 2086 (365) projected
  [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30], // 2087 (366) projected
  [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30], // 2088 (365) projected
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], // 2089 (365) projected
  [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], // 2090 (365) projected
];

export const BS_LAST_YEAR = BS_FIRST_YEAR + BS_MONTH_DAYS.length - 1;
