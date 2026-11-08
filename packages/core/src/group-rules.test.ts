import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUP_COLORS } from "./group-rules";
import { createGroupSchema } from "./group-schemas";

describe("group rules module", () => {
  it("stays free of runtime imports so zod can't reach client bundles", () => {
    const source = readFileSync(new URL("./group-rules.ts", import.meta.url), "utf8");
    const runtimeImports = source.match(/^import (?!type\b).*$/gm) ?? [];
    expect(runtimeImports).toEqual([]);
  });

  it("validates colours from the shared palette", () => {
    expect(createGroupSchema.safeParse({ name: "Trip", color: GROUP_COLORS[0] }).success).toBe(
      true,
    );
    expect(createGroupSchema.safeParse({ name: "Trip", color: "mauve" }).success).toBe(false);
  });
});
