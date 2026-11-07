import type { OcrModel, OcrProvider } from "@receipt-ocr/ai/models";

/** The select value for "no choice made": the step runs the model's default. */
export const DEFAULT_EFFORT = "default";

export type EffortChoices = {
  /** More than one value to pick from. A single value is shown as fixed text. */
  choosable: boolean;
  /** What an unset step runs, in words. */
  defaultLabel: string;
  items: { value: string; label: string }[];
};

/** Null when the model has no effort setting. */
export function effortChoices(
  model: OcrModel | undefined,
  provider: OcrProvider | undefined,
): EffortChoices | null {
  const effort = model?.effort;
  if (!effort) return null;
  const by =
    effort.defaultFrom === "provider" ? `, ${provider?.label ?? "the provider"}'s own` : "";
  const defaultLabel = `Default (${effort.default}${by})`;
  return {
    choosable: effort.values.length > 1,
    defaultLabel,
    items: [
      { value: DEFAULT_EFFORT, label: defaultLabel },
      ...effort.values.map((value) => ({ value, label: value })),
    ],
  };
}
