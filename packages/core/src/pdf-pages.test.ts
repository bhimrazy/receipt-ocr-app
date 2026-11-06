import { deflateSync } from "node:zlib";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES, validateUpload } from "./files";
import { countPdfPages } from "./pdf-pages";

/** Page count, or "tooComplex" when the scan gave up. */
const count = (bytes: Uint8Array) => {
  const result = countPdfPages(bytes);
  return "tooComplex" in result ? "tooComplex" : result.pages;
};
const enc = (s: string) => new TextEncoder().encode(s);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Object numbers: 1 catalog, 2 page tree, 3.. pages. */
const pageIds = (pages: number) => Array.from({ length: pages }, (_, i) => i + 3);
const pageDict = (parent = 2) =>
  `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 200 300] /Contents 99 0 R >>`;
const treeDict = (count: number, kids: number[]) =>
  `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${count} >>`;

/** A plain PDF 1.4 with every object in the file body. */
function plainPdf(pages: number, count = pages) {
  const ids = pageIds(pages);
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Outlines << /Type /Outlines /Count 0 >> >>\nendobj`,
    `2 0 obj\n${treeDict(count, ids)}\nendobj`,
    ...ids.map((id) => `${id} 0 obj\n${pageDict()}\nendobj`),
    // A content stream whose bytes mention a page type must not count.
    `99 0 obj\n<< /Length 18 >>\nstream\n/Type /Page /Type\nendstream\nendobj`,
  ];
  return enc(`%PDF-1.4\n${objects.join("\n")}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
}

/** A PDF 1.5 with the page tree and pages inside a Flate object stream. */
function compressedPdf(pages: number, count = pages, { indirectLength = false } = {}) {
  const ids = [2, ...pageIds(pages)];
  const bodies = [treeDict(count, pageIds(pages)), ...pageIds(pages).map(() => pageDict())];
  let offset = 0;
  const header: string[] = [];
  for (const [i, id] of ids.entries()) {
    header.push(`${id} ${offset}`);
    offset += bodies[i].length + 1;
  }
  const head = `${header.join(" ")}\n`;
  const data = deflateSync(enc(head + bodies.join("\n") + "\n"));
  const length = indirectLength ? "50 0 R" : String(data.length);
  return concat(
    enc(`%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`),
    enc(
      `40 0 obj\n<< /Type /ObjStm /N ${ids.length} /First ${head.length} /Filter /FlateDecode /Length ${length} >>\nstream\n`,
    ),
    data,
    enc(`\nendstream\nendobj\n50 0 obj\n${data.length}\nendobj\n%%EOF\n`),
  );
}

describe("countPdfPages", () => {
  it.each([1, 3, 10, 50])("counts a plain %i-page PDF", (pages) => {
    expect(count(plainPdf(pages))).toBe(pages);
  });

  it.each([1, 10, 50])("counts a %i-page PDF whose pages sit in an object stream", (pages) => {
    expect(count(compressedPdf(pages))).toBe(pages);
  });

  it("reads an object stream whose /Length is an indirect reference", () => {
    expect(count(compressedPdf(12, 12, { indirectLength: true }))).toBe(12);
  });

  it("can't be fooled by a page tree that under-reports /Count", () => {
    expect(count(plainPdf(50, 1))).toBe(50);
    expect(count(compressedPdf(50, 1))).toBe(50);
  });

  it("counts a /Count larger than the visible pages", () => {
    expect(count(plainPdf(1, 40))).toBe(40);
  });

  it("overcounts pages deleted by an incremental save (known, safe direction)", () => {
    // The update rewrites the page tree to keep 4 of 12 pages, but the 8 dropped page
    // objects are still in the file. Without a real parser we can't tell they are
    // unreachable, so the file counts 12 and may be rejected. Never undercounting
    // matters more than accepting such files; the error message tells the user to export.
    const kept = pageIds(12).slice(0, 4);
    const update = enc(
      `2 0 obj\n${treeDict(4, kept)}\nendobj\ntrailer\n<< /Root 1 0 R /Prev 0 >>\n%%EOF\n`,
    );
    expect(count(concat(plainPdf(12), update))).toBe(12);
  });

  it("counts a page rewritten by an incremental update once", () => {
    const update = enc(`3 0 obj\n${pageDict()}\nendobj\ntrailer\n<< /Prev 0 >>\n%%EOF\n`);
    expect(count(concat(plainPdf(3), update))).toBe(3);
  });

  it("reads the linearization page count", () => {
    const pdf = enc(`%PDF-1.6\n9 0 obj\n<< /Linearized 1 /L 1000 /N 25 /T 900 >>\nendobj\n%%EOF`);
    expect(count(pdf)).toBe(25);
  });

  it("returns 0 for a PDF with no readable page objects", () => {
    expect(count(enc("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"))).toBe(0);
  });

  it("ignores an object stream that won't inflate (e.g. encrypted)", () => {
    const pdf = concat(
      plainPdf(2),
      enc(`7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 8 >>\nstream\n`),
      enc("garbage!"),
      enc("\nendstream\nendobj\n"),
    );
    expect(count(pdf)).toBe(2);
  });

  it("refuses an object stream that inflates past the budget", () => {
    const bomb = deflateSync(new Uint8Array(20 * 1024 * 1024));
    const pdf = concat(
      enc(
        `%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`,
      ),
      bomb,
      enc("\nendstream\nendobj\n"),
    );
    expect(count(pdf)).toBe("tooComplex");
  });

  it("stays fast on a large file of unterminated objects", () => {
    const junk = enc("%PDF-1.4\n" + "1 0 obj /Linearized ".repeat(200_000));
    const startedAt = performance.now();
    count(junk);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });
});

describe("validateUpload PDF page cap (audit L2)", () => {
  it(`accepts a PDF of ${MAX_PDF_PAGES} pages`, () => {
    expect(Effect.runSync(validateUpload(plainPdf(MAX_PDF_PAGES)))).toBe("application/pdf");
  });

  it("rejects a 50-page PDF with a message the user can act on", () => {
    const exit = Effect.runSyncExit(validateUpload(compressedPdf(50)));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain(`up to ${MAX_PDF_PAGES} pages`);
    }
  });

  it("tells the user what to do when a PDF is too complex to check", () => {
    const exit = Effect.runSyncExit(
      validateUpload(enc("%PDF-1.4\n" + "1 0 obj<<>>endobj\n".repeat(210_000))),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("Export only the receipt pages");
    }
  });

  it("stays fast and light on 10 MB adversarial files", () => {
    const MB10 = 10 * 1024 * 1024;
    const trailers = `%PDF-1.4\n${"trailer << /Root 1 0 R >>\n".repeat(MB10 / 27)}`;
    const kids = `1 0 obj << /Type /Pages /Kids [ ${"2 0 R ".repeat(MB10 / 6)}`;
    const nested = `1 0 obj ${"<< /Kids [ ".repeat(MB10 / 11)}`;
    const header = `1 0 obj << /Type /ObjStm /N 9999999 /First 9999999 >> stream\n${"1 0 ".repeat(MB10 / 4)}`;
    const heapBefore = process.memoryUsage().heapUsed;
    for (const [name, text] of Object.entries({ trailers, kids, nested, header })) {
      const started = performance.now();
      count(enc(text));
      expect(performance.now() - started, name).toBeLessThan(1000);
    }
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(200 * 1024 * 1024);
  });

  it("stays fast on overlapping object-stream offsets", () => {
    const pairs = 40_000;
    const header = `${Array.from({ length: pairs }, (_, i) => `${i + 1} ${i % 2 ? 65_536 : 0}`).join(" ")}\n`;
    const data = deflateSync(enc(header + " ".repeat(65_546)));
    const pdf = concat(
      enc(
        `%PDF-1.5\n7 0 obj\n<< /Type /ObjStm /N ${pairs} /First ${header.length} /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
      ),
      data,
      enc("\nendstream\nendobj\n"),
    );
    const started = performance.now();
    expect(count(pdf)).toBe(0);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("stays fast on many 64 KB objects, and rejects an object flood", () => {
    const filler = "/Linearized ".repeat(5400);
    const big = Array.from({ length: 70 }, (_, i) => `${i + 1} 0 obj ${filler} endobj\n`).join("");
    let started = performance.now();
    expect(count(enc(`%PDF-1.4\n${big}`))).toBe(0);
    expect(performance.now() - started).toBeLessThan(1000);

    const flood = "1 0 obj<<>>endobj\n".repeat(210_000);
    started = performance.now();
    expect(count(enc(flood))).toBe("tooComplex");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("ignores /Linearized outside the first 1024 bytes", () => {
    const pdf = enc(`%PDF-1.6\n${" ".repeat(1100)}9 0 obj\n<< /Linearized 1 /N 25 >>\nendobj\n`);
    expect(count(pdf)).toBe(0);
  });

  it("scans ~1 MB of adversarial input in linear time", () => {
    const MB = 1024 * 1024;
    const inputs = {
      digits: "7".repeat(MB),
      zeroPairs: "0 0 ".repeat(MB / 4),
      spaceAfterDigits: `1${" ".repeat(MB)}`,
      digitSpaceRuns: "1234567890 ".repeat(MB / 11),
      pairsThenSpaces: `${"12 ".repeat(1000)}${" ".repeat(MB)}`,
      typeRuns: `1 0 obj ${"/Type /Linearized ".repeat(MB / 18)}`,
    };
    for (const [name, text] of Object.entries(inputs)) {
      const started = performance.now();
      expect(count(enc(text)), name).toBe(0);
      expect(performance.now() - started, name).toBeLessThan(1000);
    }
  });
});
