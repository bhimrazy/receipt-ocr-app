import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { INJECTION_GUARD, PROMPT_VERSION, PROMPT_VERSIONS, promptFor } from "./prompt";
import { FIELD_DESCRIPTIONS, receiptExtractionSchema } from "./schema";

const NOW = new Date("2026-11-07T12:00:00Z");

describe("extraction prompts", () => {
  it("the app's default is v2, and v1 stays selectable", () => {
    expect(PROMPT_VERSION).toBe("v2");
    expect(PROMPT_VERSIONS).toEqual(["v1", "v2"]);
  });

  it("v2: rules in a system prompt, the file before a short task with today's date", () => {
    const prompt = promptFor("v2", NOW);
    expect(prompt.fileFirst).toBe(true);
    expect(prompt.text).toBe("Today is 2026-11-07. Extract the receipt above.");
    expect(prompt.system).toContain(INJECTION_GUARD);
    for (const tag of ["rules", "general", "amounts", "items", "dates", "currency", "merchant"]) {
      expect(prompt.system).toContain(`<${tag}>`);
      expect(prompt.system).toContain(`</${tag}>`);
    }
  });

  it("v2 keeps the field-tested number rules and carries the date rules", () => {
    const system = promptFor("v2", NOW).system!;
    expect(system).toContain('IDR "25.000" is 25000');
    expect(system).toContain('KWD "1.250" is 1.25');
    expect(system).toContain("Gregorian (AD)");
    expect(system).toContain("Miti");
    expect(system).toContain("MM/DD/YYYY");
    expect(system).toContain("If only a BS date is printed, return null");
    expect(system).toContain("Never return a date after today");
  });

  it("v1 is the original single text block, before the file", () => {
    const prompt = promptFor("v1", NOW);
    expect(prompt.fileFirst).toBe(false);
    expect(prompt.system).toBeUndefined();
    expect(prompt.text.startsWith("Extract this receipt into structured data.")).toBe(true);
    expect(prompt.text).toContain('IDR "25.000" is 25000');
  });

  it("every field of the schema carries its definition, length caps kept", async () => {
    const wire = (await zodSchema(receiptExtractionSchema).jsonSchema) as {
      properties: Record<string, { description?: string; maxLength?: number; maxItems?: number }>;
    };
    const { properties } = wire;
    for (const field of Object.keys(properties)) {
      expect(properties[field]!.description, field).toBeTruthy();
    }
    expect(properties.subtotal!.description).toBe(FIELD_DESCRIPTIONS.subtotal);
    expect(properties.merchant!.maxLength).toBe(200);
    expect(properties.items!.maxItems).toBe(300);
  });
});
