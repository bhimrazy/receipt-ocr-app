import { inflateSync } from "node:zlib";

/**
 * A conservative page count for an uploaded PDF, read without a PDF library.
 *
 * Preferred answer: the pages reachable from the `/Kids` of the catalog's page tree, using
 * only the newest definition of each object, so an incremental save that deleted pages
 * counts what a reader renders. When the tree can't be followed (no catalog, indirect or
 * missing `/Kids`), it falls back to the larger of two signals over every definition in the
 * file, so a file can't pass by lying in one of them:
 * - distinct objects with `/Type /Page`, by object number;
 * - the largest `/Count` on a `/Type /Pages` node, or `/N` in a linearization dictionary.
 *
 * Objects are read both from the file body and from Flate-compressed object streams
 * (`/Type /ObjStm`, PDF 1.5+), where most modern writers put page objects. What it
 * can't see: object streams with other filters or encryption. Those PDFs count only
 * what is in plain text, which may be fewer pages than they have. A file that exceeds the
 * inflate or work budgets counts as Infinity (rejected as too large or complex).
 */
export function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const tally: Tally = {
    pages: new Set(),
    maxCount: linearizedPages(text),
    inflated: 0,
    work: 0,
    objects: 0,
    newest: new Map(),
    roots: [],
  };
  for (const { id, dict, streamStart } of topLevelObjects(text)) {
    if (!classify(tally, id, dict)) return Number.POSITIVE_INFINITY;
    if (OBJ_STM.test(dict) && !readObjectStream(tally, bytes, text, dict, streamStart)) {
      return Number.POSITIVE_INFINITY;
    }
  }
  for (const match of text.matchAll(ROOT)) tally.roots.push(match[1]);
  const reachable = reachablePages(tally);
  return reachable ?? Math.max(tally.pages.size, tally.maxCount);
}

interface Node {
  kind: "page" | "pages" | "catalog" | "other";
  /** Referenced object ids; null when `/Kids` or `/Pages` isn't a direct value. */
  refs: string[] | null;
}

interface Tally {
  pages: Set<string>;
  maxCount: number;
  inflated: number;
  /** Characters classified, across all objects and object-stream entries. */
  work: number;
  objects: number;
  /** The last definition of each relevant object id, in file order. */
  newest: Map<string, Node>;
  roots: string[];
}

const PAGE = /\/Type\s*\/Page(?![A-Za-z0-9])/;
const PAGES = /\/Type\s*\/Pages(?![A-Za-z0-9])/;
const CATALOG = /\/Type\s*\/Catalog(?![A-Za-z0-9])/;
const COUNT = /\/Count\s+(\d+)/;
const KIDS = /\/Kids\s*\[([^\]]*)\]/;
const PAGES_REF = /\/Pages\s+(\d{1,10})\s{1,16}\d{1,10}\s{1,16}R\b/;
const ROOT = /\/Root\s+(\d{1,10})\s{1,16}\d{1,10}\s{1,16}R\b/g;
const REF = /(?<![0-9])(\d{1,10})\s{1,16}\d{1,10}\s{1,16}R\b/g;
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
/** The linearization dictionary must be among the first bytes of the file. */
const MAX_OBJSTM_ENTRIES = 65_536;
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

  let node: Node = { kind: "other", refs: [] };
  if (PAGES.test(dict)) {
    const count = COUNT.exec(dict);
    if (count) tally.maxCount = Math.max(tally.maxCount, Number(count[1]));
    node = { kind: "pages", refs: refsIn(KIDS.exec(dict)?.[1]) };
  } else if (PAGE.test(dict)) {
    tally.pages.add(id);
    node = { kind: "page", refs: [] };
  } else if (CATALOG.test(dict)) {
    const ref = PAGES_REF.exec(dict);
    node = { kind: "catalog", refs: ref ? [ref[1]] : null };
  } else if (KIDS.test(dict)) {
    // A page-tree node missing its /Type: readers still follow it.
    node = { kind: "pages", refs: refsIn(KIDS.exec(dict)?.[1]) };
  }
  if (node.kind === "other") tally.newest.delete(id);
  else tally.newest.set(id, node);
  return true;
}

function refsIn(array: string | undefined): string[] | null {
  if (array === undefined) return null;
  return Array.from(array.matchAll(REF), (m) => m[1]);
}

/**
 * Distinct page objects reachable from the page tree of any `/Root` catalog (the largest
 * wins, so a decoy trailer can't hide pages). Null when a tree can't be followed.
 */
function reachablePages(tally: Tally): number | null {
  let best: number | null = null;
  for (const root of new Set(tally.roots)) {
    const catalog = tally.newest.get(root);
    if (catalog?.kind !== "catalog" || !catalog.refs) continue;
    const found = new Set<string>();
    const seen = new Set<string>();
    const stack = [...catalog.refs];
    let ok = true;
    for (let id = stack.pop(); id !== undefined && ok; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      const node = tally.newest.get(id);
      if (!node || node.kind === "catalog" || !node.refs) ok = false;
      else if (node.kind === "page") found.add(id);
      else stack.push(...node.refs);
    }
    if (ok) best = Math.max(best ?? 0, found.size);
  }
  return best;
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
