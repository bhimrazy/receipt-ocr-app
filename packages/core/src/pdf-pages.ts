import { inflateSync } from "node:zlib";

export type PageCount = { pages: number } | { tooComplex: true };

/**
 * A conservative page count for an uploaded PDF, read without a PDF library.
 *
 * It takes the larger of two signals, so a file can't pass by lying in one of them:
 * - distinct objects with `/Type /Page`, by object number (a page rewritten by an
 *   incremental update counts once; orphaned pages from earlier revisions still count);
 * - the largest `/Count` on a `/Type /Pages` node, or `/N` in a linearization dictionary.
 *
 * It errs toward overcounting on purpose: a PDF whose pages were deleted by an incremental
 * save still counts the deleted ones, and may be rejected. Following the page tree safely
 * would need a real parser.
 *
 * Objects are read both from the file body and from Flate-compressed object streams
 * (`/Type /ObjStm`, PDF 1.5+), where most modern writers put page objects. What it
 * can't see: object streams with other filters or encryption. Those PDFs count only
 * what is in plain text, which may be fewer pages than they have. A file that exceeds the
 * inflate or work budgets is reported as `tooComplex`.
 */
export function countPdfPages(bytes: Uint8Array): PageCount {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const tally: Tally = {
    pages: new Set(),
    maxCount: linearizedPages(text),
    inflated: 0,
    work: 0,
    objects: 0,
  };
  for (const { id, dict, streamStart } of topLevelObjects(text)) {
    if (!classify(tally, id, dict)) return { tooComplex: true };
    if (OBJ_STM.test(dict) && !readObjectStream(tally, bytes, text, dict, streamStart)) {
      return { tooComplex: true };
    }
  }
  return { pages: Math.max(tally.pages.size, tally.maxCount) };
}

interface Tally {
  pages: Set<string>;
  maxCount: number;
  inflated: number;
  /** Characters classified, across all objects and object-stream entries. */
  work: number;
  objects: number;
}

const PAGE = /\/Type\s*\/Page(?![A-Za-z0-9])/;
const PAGES = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const COUNT = /\/Count\s+(\d+)/;
const LINEARIZED_N = /\/N\s+(\d+)/;
const OBJ_STM = /\/Type\s*\/ObjStm(?![A-Za-z0-9])/;
// Bounded and anchored so no match can start inside a digit run: linear on hostile input.
// Known gap: a comment between the object header and `obj` hides that object from the scan.
const OBJ_START = /(?<![0-9])(\d{1,10})\s{1,256}(\d{1,10})\s{1,256}obj\b/g;

/**
 * Budget for all inflated object streams in one file, against zip bombs. Object streams
 * hold only small dictionaries; real receipts and invoices use a few KB.
 */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** Page and page-tree dictionaries are small; longer spans are cut before matching. */
const MAX_DICT_CHARS = 64 * 1024;
/** Total characters classified and objects visited: a hard stop on CPU per upload. */
const MAX_WORK_CHARS = 32 * 1024 * 1024;
const MAX_OBJECTS = 200_000;
/** Entries read from one object stream; real writers put a few hundred at most. */
const MAX_OBJSTM_ENTRIES = 65_536;
/** The linearization dictionary must be among the first bytes of the file. */
const LINEARIZED_WINDOW = 1024;

function linearizedPages(text: string): number {
  const head = text.slice(0, LINEARIZED_WINDOW);
  const at = head.indexOf("/Linearized");
  if (at === -1) return 0;
  const n = LINEARIZED_N.exec(head.slice(at, at + 256));
  return n ? Number(n[1]) : 0;
}

/** False when the work budget is spent. */
function classify(tally: Tally, id: string, span: string): boolean {
  const dict = span.slice(0, MAX_DICT_CHARS);
  tally.work += dict.length + 64;
  if (++tally.objects > MAX_OBJECTS || tally.work > MAX_WORK_CHARS) return false;
  if (PAGES.test(dict)) {
    const count = COUNT.exec(dict);
    if (count) tally.maxCount = Math.max(tally.maxCount, Number(count[1]));
  } else if (PAGE.test(dict)) {
    tally.pages.add(id);
  }
  return true;
}

/**
 * `N G obj ... endobj` spans, each ending at the next object if `endobj` is missing.
 * `dict` stops at `stream` so binary data isn't matched. Matches are found lazily, one
 * ahead, so memory doesn't grow with the number of objects. Linear in the file size.
 */
function* topLevelObjects(text: string) {
  const re = new RegExp(OBJ_START);
  let match = re.exec(text);
  let endobj = -1;
  while (match) {
    const next = re.exec(text);
    const start = match.index + match[0].length;
    if (endobj !== Infinity && endobj < start) {
      const found = text.indexOf("endobj", start);
      endobj = found === -1 ? Infinity : found;
    }
    const end = Math.min(endobj, next?.index ?? text.length);
    const body = text.slice(start, end);
    const stream = /\bstream\r?\n/.exec(body);
    yield {
      id: match[1],
      dict: stream ? body.slice(0, stream.index) : body,
      streamStart: stream ? start + stream.index + stream[0].length : -1,
    };
    match = next;
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

  const n = Math.min(Number(/\/N\s+(\d+)/.exec(dict)?.[1] ?? 0), MAX_OBJSTM_ENTRIES);
  const first = Math.min(Number(/\/First\s+(\d+)/.exec(dict)?.[1] ?? 0), decoded.length);
  const header = decoded
    .slice(0, first)
    .trim()
    .split(/\s+/, 2 * n + 2)
    .map(Number);
  // Entries must be disjoint and increasing; overlapping offsets would rescan the same span.
  let previousEnd = 0;
  for (let i = 0; i < n && 2 * i + 1 < header.length; i++) {
    const from = header[2 * i + 1];
    const to = 2 * i + 3 < header.length ? header[2 * i + 3] : decoded.length - first;
    if (!Number.isInteger(header[2 * i]) || !Number.isInteger(from) || !Number.isInteger(to))
      continue;
    if (to <= from || from < previousEnd) continue;
    previousEnd = to;
    if (!classify(tally, String(header[2 * i]), decoded.slice(first + from, first + to)))
      return false;
  }
  return true;
}
