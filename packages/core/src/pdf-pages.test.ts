import { deflateSync } from "node:zlib";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { MAX_PDF_PAGES, validateUpload } from "./files";
import { countPdfPages } from "./pdf-pages";

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
    expect(countPdfPages(plainPdf(pages))).toBe(pages);
  });

  it.each([1, 10, 50])("counts a %i-page PDF whose pages sit in an object stream", (pages) => {
    expect(countPdfPages(compressedPdf(pages))).toBe(pages);
  });

  it("reads an object stream whose /Length is an indirect reference", () => {
    expect(countPdfPages(compressedPdf(12, 12, { indirectLength: true }))).toBe(12);
  });

  it("can't be fooled by a page tree that under-reports /Count", () => {
    expect(countPdfPages(plainPdf(50, 1))).toBe(50);
    expect(countPdfPages(compressedPdf(50, 1))).toBe(50);
  });

  it("can't be fooled by a /Count larger than the visible pages", () => {
    expect(countPdfPages(plainPdf(1, 40))).toBe(40);
  });

  it("counts a page rewritten by an incremental update once", () => {
    const update = enc(`3 0 obj\n${pageDict()}\nendobj\ntrailer\n<< /Prev 0 >>\n%%EOF\n`);
    expect(countPdfPages(concat(plainPdf(3), update))).toBe(3);
  });

  it("reads the linearization page count", () => {
    const pdf = enc(`%PDF-1.6\n9 0 obj\n<< /Linearized 1 /L 1000 /N 25 /T 900 >>\nendobj\n%%EOF`);
    expect(countPdfPages(pdf)).toBe(25);
  });

  it("returns 0 for a PDF with no readable page objects", () => {
    expect(countPdfPages(enc("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"))).toBe(0);
  });

  it("ignores an object stream that won't inflate (e.g. encrypted)", () => {
    const pdf = concat(
      plainPdf(2),
      enc(`7 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length 8 >>\nstream\n`),
      enc("garbage!"),
      enc("\nendstream\nendobj\n"),
    );
    expect(countPdfPages(pdf)).toBe(2);
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
    expect(countPdfPages(pdf)).toBe(Number.POSITIVE_INFINITY);
  });

  it("stays fast on a large file of unterminated objects", () => {
    const junk = enc("%PDF-1.4\n" + "1 0 obj /Linearized ".repeat(200_000));
    const startedAt = performance.now();
    countPdfPages(junk);
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
      expect(countPdfPages(enc(text)), name).toBe(0);
      expect(performance.now() - started, name).toBeLessThan(1000);
    }
  });
});
