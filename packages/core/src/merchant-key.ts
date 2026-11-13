import { sql, type SQL } from "@receipt-ocr/db";

/**
 * Whitespace and punctuation a merchant key drops, listed by code point.
 * Postgres's `[:punct:]`, `[:space:]` and `[:alnum:]` follow the database's
 * ctype: under C they miss everything past ASCII, and `[^[:alnum:]]` under
 * en_US drops Devanagari vowel signs and viramas. An explicit list keeps
 * every letter, mark and digit of any script, whatever the collation.
 */
const SEPARATORS = [
  // ASCII whitespace and punctuation.
  "\\t\\n\\v\\f\\r ",
  "!\"#$%&'()*+,\\-./:;<=>?@\\[\\\\\\]^_`{|}~",
  // No-break space, inverted marks, guillemets, middle dot.
  "\\u00a0\\u00a1\\u00ab\\u00b7\\u00bb\\u00bf",
  // Unicode spaces, dashes, quotes, bullets, ellipsis, separators.
  "\\u2000-\\u200b\\u2010-\\u2029\\u202f-\\u2043\\u2045-\\u205f",
  // Devanagari danda and double danda.
  "\\u0964\\u0965",
  // Ideographic space and punctuation, fullwidth forms, byte-order mark.
  "\\u3000-\\u3003\\ufeff\\uff01-\\uff0f",
].join("");

const MERCHANT_SEPARATORS = `[${SEPARATORS}]+`;

/**
 * The key merchants group and match on: lower-cased, with whitespace and
 * punctuation removed, so "Bhat-Bhateni Super Market" and "bhatbhateni
 * supermarket" are one merchant. Null when nothing is left.
 */
export const merchantKey = (value: SQL): SQL =>
  sql`nullif(regexp_replace(lower(${value}), ${MERCHANT_SEPARATORS}, '', 'g'), '')`;
