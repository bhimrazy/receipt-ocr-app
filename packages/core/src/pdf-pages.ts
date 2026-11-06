import { inflateSync } from "node:zlib";

export type PageCount = { pages: number } | { tooComplex: true };

/**
 * A conservative page count for an uploaded PDF, read without a PDF library.
 *
 * It takes the largest of three signals, so a file can't pass by lying in one of them:
 * - distinct objects with `/Type /Page`, by object number (a page rewritten by an
 *   incremental update counts once; orphaned pages from earlier revisions still count);
 * - the largest `/Count` on a `/Type /Pages` node, or `/N` in a linearization dictionary;
 * - distinct object ids listed in any `/Kids` array, which also catches untyped page trees.
 *
 * It errs toward overcounting on purpose: a PDF whose pages were deleted by an incremental
 * save still counts the deleted ones, and may be rejected. Following the page tree safely
 * would need a real parser.
 *
 * Objects are read from the file body and from object streams (`/Type /ObjStm`, PDF 1.5+)
 * that are uncompressed or plain Flate; `%` comments between an object header and `obj`
 * are skipped. Anything else that could hide pages makes the file `tooComplex`: an object
 * stream with another filter or a predictor, a name written with a `#xx` escape that
 * decodes to one the scan reads, or a file over the inflate or work budgets.
 * What it can't see: encrypted object streams, which count only the plain-text objects
 * and so may report fewer pages than they have.
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
  };
  for (const { id, dict, streamStart } of topLevelObjects(text, bytes)) {
    if (!classify(tally, id, dict)) return { tooComplex: true };
    if (OBJ_STM.test(dict) && !readObjectStream(tally, bytes, text, dict, streamStart)) {
      return { tooComplex: true };
    }
  }
  return { pages: Math.max(tally.pages.size, tally.maxCount, tally.kids.size) };
}

interface Tally {
  pages: Set<string>;
  maxCount: number;
  inflated: number;
  /** Characters classified, across all objects and object-stream entries. */
  work: number;
  objects: number;
  /** Object ids seen in `/Kids` arrays, capped: past the cap the file is far over any limit. */
  kids: Set<string>;
}

const PAGE = /\/Type\s*\/Page(?![A-Za-z0-9])/;
const PAGES = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const COUNT = /\/Count\s+(\d+)/;
const LINEARIZED_N = /\/N\s+(\d+)/;
const KIDS_REF = /(?<![0-9])(\d{1,10})\s{1,16}\d{1,10}\s{1,16}R\b/g;
/** A name containing a `#xx` escape. Unbounded runs on both sides can't overlap: linear. */
const ESCAPED_NAME = /\/[^\s/[\]<>()%#]*#[0-9A-Fa-f]{2}[^\s/[\]<>()%]*/g;
const ESCAPED_NAME_ANY = /#[0-9A-Fa-f]{2}/;
/** Names the scan reads; an escaped spelling of one would evade it. */
const READ_NAMES = new Set(["Type", "Page", "Pages", "ObjStm", "Count", "N", "Kids", "Linearized"]);
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
const MAX_KID_IDS = 10_000;
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

/** False when the work budget is spent or the dictionary hides names from the scan. */
function classify(tally: Tally, id: string, span: string): boolean {
  const dict = span.slice(0, MAX_DICT_CHARS);
  tally.work += dict.length + 64;
  if (++tally.objects > MAX_OBJECTS || tally.work > MAX_WORK_CHARS) return false;
  if (dict.includes("#") && hidesReadName(dict)) return false;
  if (PAGES.test(dict)) {
    const count = COUNT.exec(dict);
    if (count) tally.maxCount = Math.max(tally.maxCount, Number(count[1]));
  } else if (PAGE.test(dict)) {
    tally.pages.add(id);
  }
  if (dict.includes("/Kids")) collectKids(tally, dict);
  return true;
}

function hidesReadName(dict: string): boolean {
  for (const [name] of dict.matchAll(ESCAPED_NAME)) {
    const decoded = name
      .slice(1)
      .replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (READ_NAMES.has(decoded)) return true;
  }
  return false;
}

/** Ids inside each `/Kids [ ... ]`. Each search resumes after the last `]`: linear. */
function collectKids(tally: Tally, dict: string) {
  let from = 0;
  for (let at = dict.indexOf("/Kids"); at !== -1 && tally.kids.size < MAX_KID_IDS;) {
    const close = dict.indexOf("]", at);
    const end = close === -1 ? dict.length : close;
    for (const m of dict.slice(at, end).matchAll(KIDS_REF)) {
      if (tally.kids.size >= MAX_KID_IDS) break;
      tally.kids.add(m[1]);
    }
    from = end;
    at = close === -1 ? -1 : dict.indexOf("/Kids", from);
  }
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
    return m ? { index: m.index, length: m[0].length, id: m[1] } : null;
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
    const stream = /\bstream\r?\n/.exec(body);
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
  const filtered = /\/Filter\b/.test(dict);
  if (filtered && !/\/Filter\s*\[?\s*\/FlateDecode\s*\]?/.test(dict)) return false;
  if (/\/DecodeParms/.test(dict)) {
    const predictor = /\/Predictor\s+(\d+)/.exec(dict)?.[1];
    if (/\/DecodeParms\s*\[?\s*\d+\s+\d+\s+R/.test(dict) || (predictor && predictor !== "1")) {
      return false;
    }
  }
  const direct = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
  const end = direct ? streamStart + Number(direct[1]) : text.indexOf("endstream", streamStart);
  if (end <= streamStart) return true;

  const budget = MAX_INFLATED_BYTES - tally.inflated;
  let decoded: string;
  try {
    const raw = bytes.subarray(streamStart, end);
    const out = filtered ? inflateSync(raw, { maxOutputLength: budget }) : Buffer.from(raw);
    if (out.byteLength > budget) return false;
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
