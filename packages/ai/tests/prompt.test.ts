import { zodSchema } from "ai";
import { describe, expect, it } from "vitest";
import { INJECTION_GUARD, PROMPT_VERSION, PROMPT_VERSIONS, promptFor } from "../src/prompt";
import { FIELD_DESCRIPTIONS, receiptExtractionSchema, V3_FIELD_DESCRIPTIONS } from "../src/schema";

const NOW = new Date("2026-11-07T12:00:00Z");

describe("extraction prompts", () => {
  it("the app's default is v3, and v1 and v2 stay selectable", () => {
    expect(PROMPT_VERSION).toBe("v3");
    expect(PROMPT_VERSIONS).toEqual(["v1", "v2", "v3"]);
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

  it("v3 copies dates as printed instead of converting them, and keeps v2's layout", () => {
    const prompt = promptFor("v3", NOW);
    expect(prompt.fileFirst).toBe(true);
    expect(prompt.text).toBe("Today is 2026-11-07. Extract the receipt above.");
    const system = prompt.system!;
    expect(system).toContain(INJECTION_GUARD);
    expect(system).toContain('IDR "25.000" is 25000');
    expect(system).toContain("Copy every printed date into dates character for character");
    expect(system).toContain("2081/82, 081/82 or 80/81 is a fiscal year");
    expect(system).not.toContain("return null rather than converting");
    for (const tag of ["rules", "general", "amounts", "items", "dates", "numbers-on-the-bill"]) {
      expect(system).toContain(`<${tag}>`);
      expect(system).toContain(`</${tag}>`);
    }
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
    expect(properties.invoiceNumber!.description).toBe(V3_FIELD_DESCRIPTIONS.invoiceNumber);
    expect(JSON.stringify(properties.merchant)).toContain('"maxLength":200');
    expect(properties.items!.maxItems).toBe(300);
    expect(properties.dates!.maxItems).toBe(4);
  });
});
