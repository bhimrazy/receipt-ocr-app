import { inflateSync } from "node:zlib";

/**
 * A conservative page count for an uploaded PDF, read without a PDF library.
 *
 * It takes the larger of two signals, so a file can't pass by lying in one of them:
 * - distinct objects with `/Type /Page`, by object number (a page rewritten by an
 *   incremental update counts once; orphaned pages from earlier revisions still count);
 * - the largest `/Count` on a `/Type /Pages` node, or `/N` in a linearization dictionary.
 *
 * Objects are read both from the file body and from Flate-compressed object streams
 * (`/Type /ObjStm`, PDF 1.5+), where most modern writers put page objects. What it
 * can't see: object streams with other filters or encryption. Those PDFs count only
 * what is in plain text, which may be fewer pages than they have. A file whose object
 * streams inflate past MAX_INFLATED_BYTES in total counts as Infinity (rejected).
 */
export function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const tally: Tally = { pages: new Set(), maxCount: 0, inflated: 0 };
  for (const { id, dict, streamStart } of topLevelObjects(text)) {
    classify(tally, id, dict);
    if (OBJ_STM.test(dict) && !readObjectStream(tally, bytes, text, dict, streamStart)) {
      return Number.POSITIVE_INFINITY;
    }
  }
  return Math.max(tally.pages.size, tally.maxCount);
}

interface Tally {
  pages: Set<string>;
  maxCount: number;
  inflated: number;
}

const PAGE = /\/Type\s*\/Page(?![A-Za-z0-9])/;
const PAGES = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const COUNT = /\/Count\s+(\d+)/;
const LINEARIZED_N = /\/Linearized\b[\s\S]*?\/N\s+(\d+)/;
const OBJ_STM = /\/Type\s*\/ObjStm(?![A-Za-z0-9])/;
// Bounded and anchored so no match can start inside a digit run: linear on hostile input.
const OBJ_START = /(?<![0-9])(\d{1,10})\s{1,16}(\d{1,10})\s{1,16}obj\b/g;

/**
 * Budget for all inflated object streams in one file, against zip bombs. Object streams
 * hold only small dictionaries; real receipts and invoices use a few KB.
 */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** Page and page-tree dictionaries are small; longer spans are cut before matching. */
const MAX_DICT_CHARS = 64 * 1024;

function classify(tally: Tally, id: string, span: string) {
  const dict = span.slice(0, MAX_DICT_CHARS);
  if (PAGES.test(dict)) {
    const count = COUNT.exec(dict);
    if (count) tally.maxCount = Math.max(tally.maxCount, Number(count[1]));
  } else if (PAGE.test(dict)) {
    tally.pages.add(id);
  }
  const linearized = LINEARIZED_N.exec(dict);
  if (linearized) tally.maxCount = Math.max(tally.maxCount, Number(linearized[1]));
}

/**
 * `N G obj ... endobj` spans, each ending at the next object if `endobj` is missing.
 * `dict` stops at `stream` so binary data isn't matched. Linear in the file size.
 */
function* topLevelObjects(text: string) {
  const starts = [...text.matchAll(OBJ_START)];
  let endobj = -1;
  for (const [i, match] of starts.entries()) {
    const start = match.index + match[0].length;
    if (endobj !== Infinity && endobj < start) {
      const found = text.indexOf("endobj", start);
      endobj = found === -1 ? Infinity : found;
    }
    const end = Math.min(endobj, starts[i + 1]?.index ?? text.length);
    const body = text.slice(start, end);
    const stream = /\bstream\r?\n/.exec(body);
    yield {
      id: match[1],
      dict: stream ? body.slice(0, stream.index) : body,
      streamStart: stream ? start + stream.index + stream[0].length : -1,
    };
  }
}

/** Tallies the objects in one object stream. False when the inflate budget is spent. */
function readObjectStream(
  tally: Tally,
  bytes: Uint8Array,
  text: string,
  dict: string,
  streamStart: number,
): boolean {
  if (streamStart < 0) return true;
  // Only plain Flate: predictors and other filters would need a real decoder.
  if (!/\/Filter\s*\[?\s*\/FlateDecode\s*\]?/.test(dict) || /\/DecodeParms/.test(dict)) return true;
  const direct = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
  const end = direct ? streamStart + Number(direct[1]) : text.indexOf("endstream", streamStart);
  if (end <= streamStart) return true;

  const budget = MAX_INFLATED_BYTES - tally.inflated;
  let decoded: string;
  try {
    const out = inflateSync(bytes.subarray(streamStart, end), { maxOutputLength: budget });
    tally.inflated += out.byteLength;
    decoded = out.toString("latin1");
  } catch (error) {
    // Over budget: refuse the file. Encrypted or corrupt: count what is visible elsewhere.
    return !(error instanceof RangeError);
  }

  const n = Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0);
  const first = Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0);
  const header = decoded.slice(0, first).trim().split(/\s+/).map(Number);
  for (let i = 0; i < n && 2 * i + 1 < header.length; i++) {
    const from = first + header[2 * i + 1];
    const to = 2 * i + 3 < header.length ? first + header[2 * i + 3] : decoded.length;
    if (Number.isInteger(header[2 * i]))
      classify(tally, String(header[2 * i]), decoded.slice(from, to));
  }
  return true;
}
