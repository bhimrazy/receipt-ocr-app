/**
 * Dev-only: renders every template once per variant with `{{slot}}` placeholders and checks where
 * the placeholders landed. Used by scripts/generate.ts and the golden tests.
 */
import { render } from "@react-email/render";
import { ATTRIBUTE_KINDS, SLOT_KINDS, slotNames, type SlotName } from "../render";
import type { Shared } from "./layout";
import { definitions, type TemplateName } from "./templates";

export const VARIANTS = ["support", "nosupport"] as const;
export type Variant = (typeof VARIANTS)[number];

export interface Prerendered {
  html: string;
  text: string;
}

const placeholder = (name: string) => `{{${name}}}`;

/** Renders one template from the React source with the given values (placeholders or real). */
export async function renderSource(
  name: TemplateName,
  values: Record<string, string>,
): Promise<Prerendered> {
  const shared: Shared = {
    appOrigin: values.appOrigin,
    appHost: values.appHost,
    ...(values.supportEmail ? { supportEmail: values.supportEmail } : {}),
  };
  const { html, text } = definitions[name].render(values, shared);
  return { html: await render(html), text };
}

/**
 * Throws unless every placeholder is a known slot this template declares, and every one inside an
 * attribute is a URL or address kind at the start of the value (or right after `mailto:`).
 */
export function checkSlots(name: string, allowed: readonly string[], out: Prerendered) {
  const known = new Set(allowed);
  for (const slot of [...slotNames(out.html), ...slotNames(out.text)]) {
    if (!known.has(slot)) throw new Error(`${name}: unexpected slot {{${slot}}}`);
  }
  const attributes = [...out.html.matchAll(/\s[\w:-]+="([^"]*)"/g)].map((m) => m[1]);
  for (const value of attributes) {
    for (const slot of slotNames(value) as SlotName[]) {
      if (!ATTRIBUTE_KINDS.has(SLOT_KINDS[slot])) {
        throw new Error(`${name}: text slot {{${slot}}} inside an attribute`);
      }
      const at = value.indexOf(placeholder(slot));
      if (at !== 0 && !(at === 7 && value.startsWith("mailto:"))) {
        throw new Error(`${name}: {{${slot}}} must start its attribute value`);
      }
    }
  }
  // CSS rules close with "}}", so <style> blocks are skipped; placeholders never go there.
  const markup = out.html.replace(/<style>[\s\S]*?<\/style>/g, "");
  if (/<style>[\s\S]*\{\{\w+\}\}[\s\S]*<\/style>/.test(out.html)) {
    throw new Error(`${name}: slot inside a <style> block`);
  }
  const leftover = markup.replace(/\{\{\w+\}\}/g, "").match(/\{\{|\}\}/);
  if (leftover) throw new Error(`${name}: stray braces in the HTML`);
}

export async function prerenderAll() {
  const out: Record<string, Record<Variant, Prerendered>> = {};
  for (const name of Object.keys(definitions) as TemplateName[]) {
    out[name] = {} as Record<Variant, Prerendered>;
    for (const variant of VARIANTS) {
      const shared = ["appOrigin", "appHost", ...(variant === "support" ? ["supportEmail"] : [])];
      const allowed = [...shared, ...definitions[name].slots];
      const values = Object.fromEntries(allowed.map((slot) => [slot, placeholder(slot)]));
      const rendered = await renderSource(name, values);
      checkSlots(`${name}/${variant}`, allowed, rendered);
      out[name][variant] = rendered;
    }
  }
  return out;
}
