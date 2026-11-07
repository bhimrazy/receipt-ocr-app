import { constants, inflateRawSync } from "node:zlib";

export type PageCount = { pages: number } | { tooComplex: true };

/**
 * A conservative page count for an uploaded PDF, read without a PDF library.
 *
 * It takes the largest of three signals, so a file can't pass by lying in one of them:
 * - distinct objects with `/Type /Page`, by object number (a page rewritten by an
 *   incremental update counts once; orphaned pages from earlier revisions still count);
 * - the largest `/Count` on a `/Type /Pages` node, or `/N` in a linearization dictionary;
 * - distinct object ids listed in a `/Kids` array of a dictionary that also has `/Count`,
 *   minus those that are themselves tree nodes, which also catches untyped page trees.
 *   Form-field and name trees use `/Kids` without `/Count`, and readers need `/Count` on
 *   page-tree nodes, so those are left out.
 *
 * It errs toward overcounting on purpose: a PDF whose pages were deleted by an incremental
 * save still counts the deleted ones, and may be rejected. Following the page tree safely
 * would need a real parser.
 *
 * Objects are read from the file body and from object streams (`/Type /ObjStm`, PDF 1.5+)
 * that are uncompressed or plain Flate; `%` comments between an object header and `obj`
 * are skipped. Anything else that could hide pages makes the file `tooComplex`: an object
 * stream with another filter or a predictor, a Flate stream that is corrupt part way
 * through (unless the file is encrypted), `/Kids`, `/Count` or `/Type` given as an
 * indirect reference, a name written with a `#xx` escape that decodes to one the scan
 * reads, or a file over the inflate or work budgets. A bad Adler-32 checksum is ignored,
 * as readers do. Whitespace is PDF whitespace (NUL, tab, LF, FF, CR, space), and object
 * numbers may carry leading zeros.
 *
 * The page cap is a cost guard, not a security boundary: uploads are size-capped, the daily
 * quota bounds total cost and the ledger records real tokens per call. If abuse shows up,
 * count with a real reader (pdf.js in a worker with a timeout), not more hand parsing.
 *
 * Known gaps, which can report fewer pages than a reader renders. The list is not
 * exhaustive; hand parsing can't be:
 * - encrypted object streams (only plain-text objects are counted);
 * - the word `stream` inside a string, or `/stream` as a name, which cuts a dictionary short;
 * - `endobj` inside a string, which ends an object early;
 * - comments inside a dictionary, which can split a name or reference the scan reads;
 * - object-stream data that isn't zlib (no valid header), which counts only what is
 *   visible elsewhere.
 */
export function countPdfPages(bytes: Uint8Array): PageCount {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const tally: Tally = {
    pages: new Set(),
    maxCount: linearizedPages(text),
    inflated: 0,
    work: 0,
    objects: 0,
    kids: new Set(),
    treeNodes: new Set(),
    escapedNames: 0,
  };
  for (const { id, dict, streamStart } of topLevelObjects(text, bytes)) {
    if (!classify(tally, id, dict)) return { tooComplex: true };
    if (OBJ_STM.test(dict) && !readObjectStream(tally, bytes, text, dict, streamStart)) {
      return { tooComplex: true };
    }
  }
  let leaves = 0;
  for (const id of tally.kids) if (!tally.treeNodes.has(id)) leaves++;
  return { pages: Math.max(tally.pages.size, tally.maxCount, leaves) };
}

interface Tally {
  pages: Set<string>;
  maxCount: number;
  inflated: number;
  /** Characters classified, across all objects and object-stream entries. */
  work: number;
  objects: number;
  /** Object ids seen in `/Kids` arrays. */
  kids: Set<string>;
  /** Page-tree nodes (`/Type /Pages`, or `/Kids` with `/Count`), not leaves. */
  treeNodes: Set<string>;
  escapedNames: number;
}

/** PDF whitespace: NUL, tab, LF, FF, CR and space. JS `\s` misses NUL and matches others. */
const WS_CHARS = String.raw`\0\t\n\f\r `;
const W = `[${WS_CHARS}]`;
const PAGE = new RegExp(String.raw`/Type${W}*/Page(?![A-Za-z0-9])`);
const PAGES = new RegExp(String.raw`/Type${W}*/Pages(?![A-Za-z0-9])`);
const HAS_COUNT = /\/Count(?![A-Za-z0-9])/;
const COUNT = new RegExp(String.raw`/Count${W}+(\d+)`);
/** `/Kids`, `/Count` or `/Type` given as an indirect reference: the scan can't follow it. */
const INDIRECT_READ_KEY = new RegExp(
  String.raw`/(?:Kids|Count|Type)${W}+\d+${W}+\d+${W}+R(?![A-Za-z0-9])`,
);
/** `/N`: pages in a linearization dictionary, entries in an object stream. */
const N_VALUE = new RegExp(String.raw`/N${W}+(\d+)`);
// Object references and headers. Linear on hostile input: a match can only start where a
// digit run starts, `\d+` can't give a digit back to `${W}+`, and each whitespace run is
// crossed by at most two attempts. Leading zeros are dropped by objectId.
const KIDS_REF = new RegExp(String.raw`(?<![0-9])(\d+)${W}+\d+${W}+R(?![A-Za-z0-9])`, "g");
/** A name containing a `#xx` escape. Unbounded runs on both sides can't overlap: linear. */
const ESCAPED_NAME = new RegExp(
  String.raw`/[^${WS_CHARS}/[\]<>()%#]*#[0-9A-Fa-f]{2}[^${WS_CHARS}/[\]<>()%]*`,
  "g",
);
const ESCAPED_NAME_ANY = /#[0-9A-Fa-f]{2}/;
/** Names the scan reads; an escaped spelling of one would evade it. */
const READ_NAMES = new Set(["Type", "Page", "Pages", "ObjStm", "Count", "N", "Kids", "Linearized"]);
/** Longest escaped spelling of a READ_NAMES entry: 10 characters, 3 each when escaped. */
const MAX_ESCAPED_READ_NAME = 31;
const OBJ_STM = new RegExp(String.raw`/Type${W}*/ObjStm(?![A-Za-z0-9])`);
const OBJ_START = new RegExp(String.raw`(?<![0-9])(\d+)${W}+\d+${W}+obj\b`, "g");
const LEADING_ZEROS = /^0+(?=\d)/;
/** `007` and `7` name the same object. */
const objectId = (digits: string) => digits.replace(LEADING_ZEROS, "");
const STREAM = /\bstream(?:[ \t]*\r?\n|\r)/;
const FILTER = /\/Filter(?![A-Za-z0-9])/;
const FLATE_ONLY = new RegExp(String.raw`/Filter${W}*\[?${W}*/FlateDecode${W}*\]?`);
const DECODE_PARMS_REF = new RegExp(String.raw`/DecodeParms${W}*\[?${W}*\d+${W}+\d+${W}+R`);
const PREDICTOR = new RegExp(String.raw`/Predictor${W}+(\d+)`);
const DIRECT_LENGTH = new RegExp(String.raw`/Length${W}+(\d+)\b(?!${W}+\d+${W}+R)`);
const FIRST = new RegExp(String.raw`/First${W}+(\d+)`);
const WS_RUN = new RegExp(`${W}+`);

/**
 * Budget for all inflated object streams in one file, against zip bombs. Object streams
 * hold only small dictionaries; real receipts and invoices use a few KB.
 */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** Total characters classified and objects visited: a hard stop on CPU per upload. */
const MAX_WORK_CHARS = 32 * 1024 * 1024;
const MAX_OBJECTS = 200_000;
/** Distinct `/Kids` ids before the file counts as too complex; far above any page limit. */
/** Names with a `#xx` escape examined per file before it counts as too complex. */
const MAX_ESCAPED_NAMES = 10_000;
const MAX_KID_IDS = 10_000;
/** Entries read from one object stream; real writers put a few hundred at most. */
const MAX_OBJSTM_ENTRIES = 65_536;
/** The linearization dictionary must be among the first bytes of the file. */
const LINEARIZED_WINDOW = 1024;

function linearizedPages(text: string): number {
  const head = text.slice(0, LINEARIZED_WINDOW);
  const at = head.indexOf("/Linearized");
  if (at === -1) return 0;
  const n = N_VALUE.exec(head.slice(at, at + 256));
  return n ? Number(n[1]) : 0;
}

/** False when the work budget is spent or the dictionary hides names from the scan. */
function classify(tally: Tally, id: string, dict: string): boolean {
  tally.work += dict.length + 64;
  if (++tally.objects > MAX_OBJECTS || tally.work > MAX_WORK_CHARS) return false;
  if (dict.includes("#") && hidesReadName(tally, dict)) return false;
  if (INDIRECT_READ_KEY.test(dict)) return false;
  if (PAGES.test(dict)) {
    tally.treeNodes.add(id);
    const count = COUNT.exec(dict);
    if (count) tally.maxCount = Math.max(tally.maxCount, Number(count[1]));
  } else if (PAGE.test(dict)) {
    tally.pages.add(id);
  }
  if (dict.includes("/Kids") && HAS_COUNT.test(dict)) {
    tally.treeNodes.add(id);
    return collectKids(tally, dict);
  }
  return true;
}

function hidesReadName(tally: Tally, dict: string): boolean {
  for (const [name] of dict.matchAll(ESCAPED_NAME)) {
    // Real files have a handful of escaped names; a flood is treated as hiding one.
    if (++tally.escapedNames > MAX_ESCAPED_NAMES) return true;
    // Too long to be an escaped spelling of a name the scan reads; skip the decode.
    if (name.length > MAX_ESCAPED_READ_NAME) continue;
    const decoded = name
      .slice(1)
      .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (READ_NAMES.has(decoded)) return true;
  }
  return false;
}

/** Ids inside each `/Kids [ ... ]`; false past MAX_KID_IDS. Each search resumes after the last `]`: linear. */
function collectKids(tally: Tally, dict: string): boolean {
  for (let at = dict.indexOf("/Kids"); at !== -1;) {
    const close = dict.indexOf("]", at);
    const end = close === -1 ? dict.length : close;
    for (const m of dict.slice(at, end).matchAll(KIDS_REF)) {
      tally.kids.add(objectId(m[1]));
      if (tally.kids.size > MAX_KID_IDS) return false;
    }
    at = close === -1 ? -1 : dict.indexOf("/Kids", end);
  }
  return true;
}

/**
 * Copy of the bytes with `%` comments (to the end of the line) blanked, so a comment between
 * an object header and `obj` can't hide the object. Null when there is no `%` at all.
 */
function withoutComments(bytes: Uint8Array): string | null {
  if (!bytes.includes(0x25)) return null;
  const copy = Buffer.from(bytes);
  let inComment = false;
  for (let i = 0; i < copy.length; i++) {
    const byte = copy[i];
    if (byte === 0x0a || byte === 0x0d) inComment = false;
    else if (byte === 0x25) inComment = true;
    if (inComment) copy[i] = 0x20;
  }
  return copy.toString("latin1");
}

interface ObjectStart {
  index: number;
  length: number;
  id: string;
}

/**
 * Object headers in file order, found in the raw text and in the comment-blanked copy
 * (a `%` inside binary stream data could otherwise hide a real header). Lazy and linear.
 */
function* objectStarts(text: string, bytes: Uint8Array): Generator<ObjectStart> {
  const plain = new RegExp(OBJ_START);
  const masked = withoutComments(bytes);
  const blanked = masked === null ? null : new RegExp(OBJ_START);
  const read = (re: RegExp | null, source: string | null): ObjectStart | null => {
    const m = re && source !== null ? re.exec(source) : null;
    return m ? { index: m.index, length: m[0].length, id: objectId(m[1]) } : null;
  };
  let a = read(plain, text);
  let b = read(blanked, masked);
  let consumed = 0;
  while (a || b) {
    let hit: ObjectStart;
    if (a && b && a.index === b.index) {
      hit = a.length >= b.length ? a : b;
      a = read(plain, text);
      b = read(blanked, masked);
    } else if (a && (!b || a.index < b.index)) {
      hit = a;
      a = read(plain, text);
    } else {
      hit = b as ObjectStart;
      b = read(blanked, masked);
    }
    // A header found by both scans, or inside the previous one, is skipped.
    if (hit.index < consumed) continue;
    consumed = hit.index + hit.length;
    yield hit;
  }
}

/**
 * `N G obj ... endobj` spans, each ending at the next object if `endobj` is missing.
 * `dict` stops at `stream` so binary data isn't matched. Headers are found lazily, one
 * ahead, so memory doesn't grow with the number of objects. Linear in the file size.
 */
function* topLevelObjects(text: string, bytes: Uint8Array) {
  const starts = objectStarts(text, bytes);
  let current = starts.next().value;
  let endobj = -1;
  while (current) {
    const next = starts.next().value;
    const start = current.index + current.length;
    if (endobj !== Infinity && endobj < start) {
      const found = text.indexOf("endobj", start);
      endobj = found === -1 ? Infinity : found;
    }
    const end = Math.min(endobj, next?.index ?? text.length);
    const body = text.slice(start, end);
    const stream = STREAM.exec(body);
    yield {
      id: current.id,
      dict: stream ? body.slice(0, stream.index) : body,
      streamStart: stream ? start + stream.index + stream[0].length : -1,
    };
    current = next;
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
  // Only uncompressed or plain Flate (no predictor) can be read without a real decoder.
  if (ESCAPED_NAME_ANY.test(dict)) return false;
  const filtered = FILTER.test(dict);
  if (filtered && !FLATE_ONLY.test(dict)) return false;
  if (/\/DecodeParms/.test(dict)) {
    const predictor = PREDICTOR.exec(dict)?.[1];
    if (DECODE_PARMS_REF.test(dict) || (predictor && predictor !== "1")) return false;
  }
  const direct = DIRECT_LENGTH.exec(dict);
  const end = direct ? streamStart + Number(direct[1]) : text.indexOf("endstream", streamStart);
  if (end <= streamStart) return true;

  const budget = MAX_INFLATED_BYTES - tally.inflated;
  const raw = bytes.subarray(streamStart, end);
  let out: Buffer;
  if (!filtered) {
    out = Buffer.from(raw);
  } else {
    // Not zlib (encrypted data, raw deflate): readers can't decode it either, so count
    // what is visible elsewhere.
    if (!isZlibHeader(raw)) return true;
    try {
      // Inflating without the 2-byte header skips the Adler-32 trailer, which readers
      // ignore too: a bad checksum can't throw away a stream that otherwise decodes.
      out = inflateRawSync(raw.subarray(2), {
        maxOutputLength: budget,
        finishFlush: constants.Z_SYNC_FLUSH,
      });
    } catch (error) {
      // Over budget: refuse. Corrupt part way through: a reader keeps what decoded before
      // the error, which can't be recovered here, so refuse unless the file is encrypted.
      if (error instanceof RangeError) return false;
      return text.includes("/Encrypt");
    }
  }
  if (out.byteLength > budget) return false;
  tally.inflated += out.byteLength;
  const decoded = out.toString("latin1");

  const n = Math.min(Number(N_VALUE.exec(dict)?.[1] ?? 0), MAX_OBJSTM_ENTRIES);
  const first = Math.min(Number(FIRST.exec(dict)?.[1] ?? 0), decoded.length);
  const header = decoded
    .slice(0, first)
    .split(WS_RUN, 2 * n + 3)
    .filter(Boolean)
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

/** A zlib header with the Deflate method and no preset dictionary (RFC 1950). */
function isZlibHeader(raw: Uint8Array): boolean {
  if (raw.length < 2) return false;
  const [cmf, flg] = raw;
  return (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && (flg & 0x20) === 0 && (cmf * 256 + flg) % 31 === 0;
}
