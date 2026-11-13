import { constants, deflateRawSync, deflateSync } from "node:zlib";
import { Effect, Exit } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { MAX_PDF_PAGES, validateUpload } from "../src/files";
import { countPdfPages } from "../src/pdf-pages";

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

  it("ignores an object stream that isn't zlib data (e.g. encrypted)", () => {
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

  describe("page-hiding tricks", () => {
    const kidsRefs = (n: number) => Array.from({ length: n }, (_, i) => `${10 + i} 0 R`).join(" ");
    /** An object stream holding one page tree with /Count 20. */
    const objStmPdf = ({
      extraDict = "",
      type = "/ObjStm",
      compress = true,
      streamKeyword = "stream\n",
      encode = (raw: Uint8Array): Uint8Array => deflateSync(raw),
      prefix = "",
    } = {}) => {
      const body = `${treeDict(
        20,
        Array.from({ length: 20 }, (_, i) => 10 + i),
      )} `;
      const head = `2 0\n`;
      const raw = enc(head + body);
      const data = compress ? encode(raw) : raw;
      const filter = compress ? "/Filter /FlateDecode " : "";
      return concat(
        enc(
          `%PDF-1.5\n${prefix}5 0 obj\n<< /Type ${type} /N 1 /First ${head.length} ${filter}${extraDict} /Length ${data.length} >>\n${streamKeyword}`,
        ),
        data,
        enc("\nendstream\nendobj\n"),
      );
    };

    it("counts objects whose header has a % comment before obj", () => {
      const pages = Array.from(
        { length: 20 },
        (_, i) => `${10 + i} 0 %c\nobj\n${pageDict()}\nendobj\n`,
      );
      expect(count(enc(`%PDF-1.4\n${pages.join("")}`))).toBe(20);
    });

    it("still finds a header after a % in the line before it", () => {
      const pdf = enc(
        `%PDF-1.4\n3 0 obj\n<< /Length 9 >>\nstream\nab %cd\nendstream endobj 4 0 obj ${pageDict()} endobj\n`,
      );
      expect(count(pdf)).toBe(1);
    });

    it("rejects names written with #xx escapes that the scan reads", () => {
      const tree = `1 0 obj\n<< /Type /P#61ges /Kids [${kidsRefs(20)}] /Count 20 >>\nendobj\n`;
      expect(count(enc(`%PDF-1.4\n${tree}`))).toBe("tooComplex");
      expect(count(enc("%PDF-1.4\n1 0 obj\n<< /Type /Page /Obj#53tm 1 >>\nendobj\n"))).toBe(
        "tooComplex",
      );
    });

    it("ignores #xx escapes in names the scan doesn't read", () => {
      const pdf = enc(`%PDF-1.4\n1 0 obj\n<< /Type /Page /Font << /F#31 2 0 R >> >>\nendobj\n`);
      expect(count(pdf)).toBe(1);
    });

    it("reads an object stream with a no-op predictor in /DecodeParms", () => {
      expect(count(objStmPdf({ extraDict: "/DecodeParms << /Predictor 1 >>" }))).toBe(20);
    });

    it("reads an uncompressed object stream", () => {
      expect(count(objStmPdf({ compress: false }))).toBe(20);
    });

    it("rejects object streams it can't decode", () => {
      expect(count(objStmPdf({ extraDict: "/DecodeParms << /Predictor 12 /Columns 5 >>" }))).toBe(
        "tooComplex",
      );
      expect(count(objStmPdf({ extraDict: "/DecodeParms 9 0 R" }))).toBe("tooComplex");
      expect(count(objStmPdf({ extraDict: "/Obj#53tm", type: "/Obj#53tm" }))).toBe("tooComplex");
      const lzw = enc(
        "%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 1 /First 2 /Filter /LZWDecode /Length 4 >>\nstream\nabcd\nendstream\nendobj\n",
      );
      expect(count(lzw)).toBe("tooComplex");
    });

    it("doesn't count intermediate tree nodes as pages (two-level tree)", () => {
      const leaves = Array.from({ length: 10 }, (_, i) => 20 + i);
      const objects = [
        `1 0 obj\n<< /Type /Pages /Kids [10 0 R 11 0 R] /Count 10 >>\nendobj\n`,
        `10 0 obj\n<< /Type /Pages /Parent 1 0 R /Kids [${leaves
          .slice(0, 5)
          .map((n) => `${n} 0 R`)
          .join(" ")}] /Count 5 >>\nendobj\n`,
        `11 0 obj\n<< /Parent 1 0 R /Count 5 /Kids [${leaves
          .slice(5)
          .map((n) => `${n} 0 R`)
          .join(" ")}] >>\nendobj\n`,
        ...leaves.map((n) => `${n} 0 obj\n<< /MediaBox [0 0 1 1] >>\nendobj\n`),
      ];
      expect(count(enc(`%PDF-1.4\n${objects.join("")}`))).toBe(10);
    });

    it("rejects a file with more distinct /Kids ids than it will track", () => {
      const refs = Array.from({ length: 10_001 }, (_, i) => `${i + 100} 0 R`).join(" ");
      expect(count(enc(`%PDF-1.4\n1 0 obj << /Count 1 /Kids [${refs}] >> endobj`))).toBe(
        "tooComplex",
      );
    });

    it("reads the prefix of a truncated object stream", () => {
      const body = `${treeDict(20, [])} ${"x".repeat(5000)}`;
      const data = deflateSync(enc(`2 0\n${body}`), { level: 0 });
      const cut = data.subarray(0, data.length - 3000);
      const pdf = concat(
        enc(
          `%PDF-1.5\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${cut.length} >>\nstream\n`,
        ),
        cut,
        enc("\nendstream\nendobj\n"),
      );
      expect(count(pdf)).toBe(20);
    });

    it("rejects /Kids arrays that list 10,000 tree nodes before the real pages", () => {
      const nodes = Array.from({ length: 10_000 }, (_, i) => 100 + i);
      const objects = [
        `1 0 obj << /Count 1 /Kids [${nodes.map((n) => `${n} 0 R`).join(" ")}] >> endobj\n`,
        ...nodes.map((n) => `${n} 0 obj << /Count 0 /Kids [] >> endobj\n`),
        `2 0 obj << /Count 1 /Kids [${kidsRefs(20)}] >> endobj\n`,
      ];
      expect(count(enc(`%PDF-1.4\n${objects.join("")}`))).toBe("tooComplex");
    });

    it("counts the ids in /Kids of an untyped page tree that under-reports /Count", () => {
      const objects = [
        `1 0 obj\n<< /Kids [${kidsRefs(20)}] /Count 1 >>\nendobj\n`,
        ...Array.from(
          { length: 20 },
          (_, i) => `${10 + i} 0 obj\n<< /MediaBox [0 0 1 1] >>\nendobj\n`,
        ),
      ];
      expect(count(enc(`%PDF-1.4\n${objects.join("")}`))).toBe(20);
    });

    /** Pages 10..29 under tree 2, with every token separator and object number rewritten. */
    const spelledPdf = (sep: (gap: number) => string, num: (n: number) => string) => {
      const ref = (n: number) => `${num(n)}${sep(1)}0${sep(1)}R`;
      const header = (n: number) => `${num(n)}${sep(2)}0${sep(2)}obj`;
      const ids = Array.from({ length: 20 }, (_, i) => 10 + i);
      const objects = [
        `${header(2)}\n<< /Type${sep(1)}/Pages /Kids [${ids.map(ref).join(" ")}] /Count${sep(1)}20 >>\nendobj\n`,
        ...ids.map((n) => `${header(n)}\n<< /Type${sep(1)}/Page /Parent ${ref(2)} >>\nendobj\n`),
      ];
      return enc(`%PDF-1.4\n${objects.join("")}`);
    };

    it("reads object numbers with leading zeros", () => {
      expect(
        count(
          spelledPdf(
            () => " ",
            (n) => String(n).padStart(11, "0"),
          ),
        ),
      ).toBe(20);
    });

    it("reads headers and references with long whitespace runs", () => {
      expect(count(spelledPdf((gap) => " ".repeat(gap === 2 ? 300 : 20), String))).toBe(20);
    });

    it("treats NUL as whitespace, as PDF does", () => {
      expect(count(spelledPdf(() => "\0", String))).toBe(20);
    });

    it("rejects /Kids, /Count or /Type given as an indirect reference", () => {
      const pages = Array.from({ length: 20 }, (_, i) => 4 + i);
      const untyped = pages.map((n) => `${n} 0 obj << /Parent 2 0 R >> endobj\n`).join("");
      const typedByRef = pages
        .map((n) => `${n} 0 obj << /Type 25 0 R /Parent 2 0 R >> endobj\n`)
        .join("");
      const kidsArray = `24 0 obj [${pages.map((n) => `${n} 0 R`).join(" ")}] endobj\n`;
      const tree = `2 0 obj << /Type /Pages /Kids 24 0 R /Count 3 0 R >> endobj\n3 0 obj 20 endobj\n`;
      expect(count(enc(`%PDF-1.4\n${tree}${kidsArray}${untyped}`))).toBe("tooComplex");
      expect(count(enc(`%PDF-1.4\n${tree}${kidsArray}${typedByRef}25 0 obj /Page endobj\n`))).toBe(
        "tooComplex",
      );
    });

    it("reads an object stream whose stream keyword ends in a space or a bare CR", () => {
      expect(count(objStmPdf({ streamKeyword: "stream \n" }))).toBe(20);
      expect(count(objStmPdf({ streamKeyword: "stream\r" }))).toBe(20);
    });

    it("reads an object stream with a bad Adler-32 checksum, as readers do", () => {
      const badChecksum = (raw: Uint8Array) => {
        const data = deflateSync(raw);
        for (let i = 1; i <= 4; i++) data[data.length - i] ^= 0xff;
        return data;
      };
      expect(count(objStmPdf({ encode: badChecksum }))).toBe(20);
    });

    it("rejects an object stream that is corrupt part way through, unless encrypted", () => {
      // Valid zlib header and blocks, then a block of the reserved type 3.
      const corruptTail = (raw: Uint8Array) =>
        concat(
          new Uint8Array([0x78, 0x9c]),
          deflateRawSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }),
          new Uint8Array([0xff, 0xff]),
        );
      expect(count(objStmPdf({ encode: corruptTail }))).toBe("tooComplex");
      // Encrypted object streams are a known gap: they count what is visible elsewhere.
      const encrypted = objStmPdf({
        encode: corruptTail,
        prefix: "9 0 obj << /Encrypt 8 0 R >> endobj\n",
      });
      expect(count(encrypted)).toBe(0);
    });

    it("doesn't count /Kids of form fields on a one-page form", () => {
      // Four radio groups of three buttons: twelve widget ids under field /Kids.
      const groups = [0, 1, 2, 3].map((g) => [0, 1, 2].map((k) => 60 + g * 3 + k));
      const objects = [
        `1 0 obj << /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [50 0 R 51 0 R 52 0 R 53 0 R] >> >> endobj\n`,
        `2 0 obj ${treeDict(1, [3])} endobj\n`,
        `3 0 obj << /Type /Page /Parent 2 0 R /Annots [${groups
          .flat()
          .map((k) => `${k} 0 R`)
          .join(" ")}] >> endobj\n`,
        ...groups.map(
          (kids, g) =>
            `${50 + g} 0 obj << /FT /Btn /Ff 49152 /T (g${g}) /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >> endobj\n`,
        ),
        ...groups
          .flat()
          .map(
            (k) =>
              `${k} 0 obj << /Type /Annot /Subtype /Widget /Parent ${50 + Math.floor((k - 60) / 3)} 0 R /P 3 0 R >> endobj\n`,
          ),
      ];
      expect(count(enc(`%PDF-1.4\n${objects.join("")}`))).toBe(1);
    });

    it("doesn't count /Kids of a /Dests name tree (pdfTeX)", () => {
      const leaves = Array.from({ length: 9 }, (_, i) => 71 + i);
      const objects = [
        `1 0 obj << /Type /Catalog /Pages 2 0 R /Names << /Dests 70 0 R >> >> endobj\n`,
        `2 0 obj ${treeDict(3, [3, 4, 5])} endobj\n`,
        ...[3, 4, 5].map((n) => `${n} 0 obj ${pageDict()} endobj\n`),
        `70 0 obj << /Kids [${leaves.map((k) => `${k} 0 R`).join(" ")}] >> endobj\n`,
        ...leaves.map(
          (k, j) =>
            `${k} 0 obj << /Names [(d${j}a) [3 0 R /XYZ 0 0 0] (d${j}b) [4 0 R /Fit]] /Limits [(d${j}a) (d${j}b)] >> endobj\n`,
        ),
      ];
      expect(count(enc(`%PDF-1.4\n${objects.join("")}`))).toBe(3);
    });
  });
});

it("ignores /Linearized outside the first 1024 bytes", () => {
  const pdf = enc(`%PDF-1.6\n${" ".repeat(1100)}9 0 obj\n<< /Linearized 1 /N 25 >>\nendobj\n`);
  expect(count(pdf)).toBe(0);
});

describe("countPdfPages on hostile input", { timeout: 60_000 }, () => {
  // Timed against a same-process baseline rather than a wall-clock bound, so a loaded CI
  // runner slows both sides. The fastest of a few runs is the one least hit by load.
  const MB10 = 10 * 1024 * 1024;
  const fastest = (bytes: Uint8Array, runs = 2) => {
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
      const started = performance.now();
      countPdfPages(bytes);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  /** An honest-shaped 10 MB page tree: one /Kids array, the scan's heaviest path. */
  let baselineMs = 0;
  beforeAll(() => {
    const kids = `1 0 obj << /Type /Pages /Count 1 /Kids [ ${"2 0 R ".repeat(MB10 / 6)}] >> endobj`;
    baselineMs = fastest(enc(kids), 3);
  });
  const expectFast = (inputs: Record<string, string | Uint8Array>) => {
    for (const [name, input] of Object.entries(inputs)) {
      const ms = fastest(typeof input === "string" ? enc(input) : input);
      expect(
        ms,
        `${name}: ${ms.toFixed(0)} ms vs baseline ${baselineMs.toFixed(0)} ms`,
      ).toBeLessThan(5 * baselineMs);
    }
  };

  it("stays fast on 10 MB of comments, escapes and kids", () => {
    expectFast({
      unterminated: `%PDF-1.4\n${"1 0 obj /Linearized ".repeat(MB10 / 20)}`,
      comments: `%PDF-1.4\n${"1 0 %c\n".repeat(MB10 / 7)}`,
      longComments: `%PDF-1.4\n${`1 0 %${"x".repeat(250)}\n`.repeat(MB10 / 256)}`,
      percents: "%".repeat(MB10),
      escapes: `1 0 obj << ${"/N#41me ".repeat(MB10 / 7)}`,
      oneLongEscapedName: `1 0 obj << /${"a#41".repeat(MB10 / 4)}`,
      kidsNoClose: `1 0 obj << /Count 1 ${"/Kids ".repeat(MB10 / 6)}`,
      kidsRefs: `1 0 obj << /Count 1 /Kids [${"1 0 R ".repeat(MB10 / 6)}`,
      bigDict: `1 0 obj << ${"/A 1 ".repeat(MB10 / 5)} >> endobj`,
      bigDicts: Array.from(
        { length: 5 },
        (_, i) => `${i + 1} 0 obj << /Count 1 ${"/Kids [ ".repeat(MB10 / 40)} >> endobj\n`,
      ).join(""),
      bigPageDict: `1 0 obj << /Type /Page ${"/Kids ".repeat(MB10 / 12)}${"/Count 1 ".repeat(MB10 / 18)} >> endobj`,
    });
  });

  it("stays fast on long whitespace and zero runs between header and reference tokens", () => {
    const spaces = " ".repeat(MB10 / 2);
    expectFast({
      wideHeader: `1${spaces}0${spaces}ob`,
      wideHeaders: `1${" ".repeat(1000)}0${" ".repeat(1000)}ob `.repeat(MB10 / 2006),
      wideRef: `1 0 obj << /Count 1 /Kids [1${spaces}0${spaces}Q`,
      nearRefs: `1 0 obj << /Count 1 /Kids [${`1${" ".repeat(16)}1${" ".repeat(16)}Q `.repeat(MB10 / 36)}`,
      zeros: "0".repeat(MB10),
      zeroRuns: `${"0".repeat(5000)} `.repeat(MB10 / 5001),
      zeroRefs: `1 0 obj << /Count 1 /Kids [${`${"0".repeat(5000)} `.repeat(MB10 / 5001)}`,
      nulPairs: "1\0".repeat(MB10 / 2),
      indirectNearMiss: `1 0 obj << ${"/Type 1 1 ".repeat(MB10 / 10)}`,
    });
  });

  it("stays fast and light on 10 MB adversarial files", () => {
    const heapBefore = process.memoryUsage().heapUsed;
    expectFast({
      trailers: `%PDF-1.4\n${"trailer << /Root 1 0 R >>\n".repeat(MB10 / 27)}`,
      kids: `1 0 obj << /Type /Pages /Kids [ ${"2 0 R ".repeat(MB10 / 6)}`,
      nested: `1 0 obj ${"<< /Count 1 /Kids [ ".repeat(MB10 / 20)}`,
      header: `1 0 obj << /Type /ObjStm /N 9999999 /First 9999999 >> stream\n${"1 0 ".repeat(MB10 / 4)}`,
    });
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
    expect(count(pdf)).toBe(0);
    expectFast({ overlapping: pdf });
  });

  it("stays fast on many 64 KB objects, and rejects an object flood", () => {
    const filler = "/Linearized ".repeat(5400);
    const big = Array.from({ length: 70 }, (_, i) => `${i + 1} 0 obj ${filler} endobj\n`).join("");
    expect(count(enc(`%PDF-1.4\n${big}`))).toBe(0);
    const flood = "1 0 obj<<>>endobj\n".repeat(210_000);
    expect(count(enc(flood))).toBe("tooComplex");
    expectFast({ big: `%PDF-1.4\n${big}`, flood });
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
    for (const [name, text] of Object.entries(inputs)) expect(count(enc(text)), name).toBe(0);
    // A tenth of the 10 MB budget: quadratic behaviour would blow far past it.
    for (const [name, text] of Object.entries(inputs)) {
      expect(fastest(enc(text)), name).toBeLessThan(baselineMs / 2);
    }
  });
});
