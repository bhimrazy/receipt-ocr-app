import type { Detection } from "@receipt-ocr/vision";
import { isDetected, isFullFrame, type EditState } from "./edit-state";

export const CROP_OUTCOMES = ["kept", "adjusted", "full_image", "none"] as const;
export type CropOutcome = (typeof CROP_OUTCOMES)[number];
export const DETECTION_LEVELS = [
  "apply",
  "suggest",
  "none",
] as const satisfies readonly Detection["level"][];

export type CropInfo = { outcome: CropOutcome; level: Detection["level"] };

/**
 * What became of the detected crop in the edit that is uploaded: `none` when detection found no
 * outline, `kept` when the crop is still the outline, `full_image` when it was dropped for the
 * whole frame (including a suggestion nobody accepted), `adjusted` for any other crop.
 */
export function cropInfo(edit: EditState): CropInfo {
  const level = edit.level;
  if (!edit.detected) return { outcome: "none", level };
  if (isDetected(edit)) return { outcome: "kept", level };
  return { outcome: isFullFrame(edit.quad) ? "full_image" : "adjusted", level };
}
