import type { Detection } from "@receipt-ocr/vision";
import { isDetected, isFullFrame, type EditState } from "./edit-state";

export const CROP_OUTCOMES = ["kept", "adjusted", "full_image", "manual", "none"] as const;
export type CropOutcome = (typeof CROP_OUTCOMES)[number];
export const DETECTION_LEVELS = [
  "apply",
  "suggest",
  "none",
] as const satisfies readonly Detection["level"][];
/** Where the photo came from: the in-app camera, the phone's camera app, or a picked or dropped file. */
export const CROP_SOURCES = ["camera", "camera_app", "library"] as const;
export type CropSource = (typeof CROP_SOURCES)[number];

export type CropInfo = {
  outcome: CropOutcome;
  level: Detection["level"];
  /** The photo was open in the review sheet; false means the starting edit went unseen. */
  seen: boolean;
  source?: CropSource;
};

/**
 * What became of the detected crop in the edit that is uploaded: `none` when detection found no
 * outline and the photo stayed whole, `manual` when it found none and the user cropped anyway,
 * `kept` when the crop is still the outline, `full_image` when it was dropped for the whole
 * frame (including a suggestion nobody accepted), `adjusted` for any other crop.
 */
export function cropInfo(
  edit: EditState,
  { seen, source }: { seen: boolean; source?: CropSource },
): CropInfo {
  const { level } = edit;
  const base = { level, seen, ...(source ? { source } : {}) };
  if (!edit.detected) return { outcome: isFullFrame(edit.quad) ? "none" : "manual", ...base };
  if (isDetected(edit)) return { outcome: "kept", ...base };
  return { outcome: isFullFrame(edit.quad) ? "full_image" : "adjusted", ...base };
}
