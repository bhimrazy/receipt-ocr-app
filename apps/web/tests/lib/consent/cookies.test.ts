import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { entryCovers, storageEntries } from "@/lib/consent/cookies";

const web = path.join(import.meta.dirname, "../../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const files = [
  ...["app", "components", "lib", "public"].flatMap((dir) => sourceFiles(path.join(web, dir))),
  path.join(web, "proxy.ts"),
];
const sources = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));

// String constants anywhere in the scanned code, so `cookies.set(SOME_NAME, …)` resolves.
const constants = new Map<string, string>();
for (const { text } of sources) {
  for (const m of text.matchAll(/const (\w+) = (["'`])([^"'`\n]*)\2/g)) constants.set(m[1]!, m[3]!);
}

/** A literal, a template (unresolved `${…}` parts become `*`) or a constant's name. */
function resolve(arg: string): string | null {
  const literal = /^(["'`])(.*)\1$/.exec(arg.trim());
  const body = literal ? literal[2]! : (constants.get(arg.trim()) ?? null);
  if (body === null) return null;
  return body.replace(/\$\{\s*(\w+)\s*\}/g, (_, name: string) => constants.get(name) ?? "*");
}

const setters = [
  /(?:cookies|cookieStore)(?:\(\)\))?\.set\(\s*([^,)]+)/g,
  /(?:localStorage|sessionStorage)\.setItem\(\s*([^,)]+)/g,
  /caches\.open\(\s*([^,)]+)/g,
  /indexedDB\.open\(\s*([^,)]+)/g,
];

type Found = { file: string; name: string | null; raw: string };

function namesInCode(): Found[] {
  const found: Found[] = [];
  for (const { file, text } of sources) {
    const rel = path.relative(web, file);
    for (const pattern of setters) {
      for (const m of text.matchAll(pattern))
        found.push({ file: rel, raw: m[1]!, name: resolve(m[1]!) });
    }
    // document.cookie = `name=…`; deletions (Max-Age=0) set nothing.
    for (const m of text.matchAll(/document\.cookie\s*=\s*(["'`])([^=]*)=([^\n]*)/g)) {
      if (m[3]!.includes("Max-Age=0")) continue;
      found.push({ file: rel, raw: m[2]!, name: resolve(`${m[1]}${m[2]}${m[1]}`) });
    }
  }
  return found;
}

describe("cookie and storage registry", () => {
  const found = namesInCode();

  it("finds the names the app is known to set (the scanner works)", () => {
    const names = found.map((f) => f.name);
    expect(names).toContain("signed_in_hint");
    expect(names).toContain("consent");
  });

  it("lists every cookie and storage key the code sets", () => {
    const missing = found
      .filter(
        (f) => f.name === null || !storageEntries.some((entry) => entryCovers(entry, f.name!)),
      )
      .map((f) => `${f.file}: ${f.name ?? `unresolved ${f.raw}`}`);
    // Add an entry to lib/consent/cookies.ts (it feeds /cookies), or make the name a string constant.
    expect(missing).toEqual([]);
  });

  it("matches Better Auth's default cookie names", () => {
    // The registry lists better-auth.* names; a custom prefix or cookie cache would change them.
    const auth = readFileSync(path.join(web, "lib/auth.ts"), "utf8");
    expect(auth).not.toMatch(/cookiePrefix|storeAccountCookie/);
    expect(auth).toMatch(/cookieCache:\s*\{\s*enabled:\s*false/);
    expect(storageEntries.some((e) => e.name === "better-auth.session_token")).toBe(true);
  });
});
