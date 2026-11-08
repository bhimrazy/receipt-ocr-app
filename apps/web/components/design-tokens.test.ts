import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Colours, small text sizes and hover washes come from theme tokens in
// packages/ui/src/styles.css. This fails when a literal sneaks back into app UI.
const webRoot = path.resolve(import.meta.dirname, "..");

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "arbitrary hex colour", pattern: /-\[#[0-9a-fA-F]{3,8}\]/ },
  {
    name: "white/black colour (use a token; black shadows are fine)",
    pattern:
      /\b(?:bg|text|border|ring|outline|divide|from|via|to|fill|stroke|decoration|caret|placeholder)-(?:white|black)\b/,
  },
  {
    name: "raw Tailwind palette colour",
    pattern:
      /\b(?:bg|text|border|ring|outline|divide|from|via|to|fill|stroke|shadow|decoration|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  },
  { name: "pixel text size (use text-2xs/text-xs…)", pattern: /\btext-\[\d+px\]/ },
  { name: "arbitrary opacity (use bg-wash or a /5 step)", pattern: /\/\[0?\.\d+\]/ },
];

// Not checked: Satori images (no CSS variables).
const EXCLUDED = [/opengraph-image\.tsx$/];

// Existing literals in files other open PRs own. Remove an entry once that file uses tokens;
// new files are always checked.
const PENDING = new Set<string>([]);

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(webRoot, dir), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => path.relative(webRoot, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join("/"));
}

function violations(source: string) {
  const found: string[] = [];
  source.split("\n").forEach((line, index) => {
    for (const rule of RULES) {
      const match = line.match(rule.pattern);
      if (match) found.push(`${index + 1}: ${rule.name}: ${match[0]}`);
    }
  });
  return found;
}

describe("design tokens", () => {
  const files = [...sourceFiles("app"), ...sourceFiles("components")].filter(
    (file) => !EXCLUDED.some((pattern) => pattern.test(file)),
  );

  it("app UI uses theme tokens instead of literal colours and sizes", () => {
    const report = files
      .filter((file) => !PENDING.has(file))
      .flatMap((file) =>
        violations(readFileSync(path.join(webRoot, file), "utf8")).map((v) => `${file}:${v}`),
      );
    expect(report).toEqual([]);
  });

  it("the pending list only names files that still have literals", () => {
    const clean = [...PENDING].filter(
      (file) =>
        !files.includes(file) ||
        violations(readFileSync(path.join(webRoot, file), "utf8")).length === 0,
    );
    expect(clean).toEqual([]);
  });

  it("flags the literals it is meant to catch", () => {
    expect(violations('className="bg-[#047857] ring-white/10 text-[11px]"')).toHaveLength(3);
    expect(violations('className="text-red-300 hover:bg-foreground/[0.06]"')).toHaveLength(2);
    expect(violations('className="bg-wash text-2xs shadow-black/40 ring-hairline"')).toEqual([]);
  });
});
