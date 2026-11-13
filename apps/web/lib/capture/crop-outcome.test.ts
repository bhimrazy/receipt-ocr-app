import type { Quad } from "@receipt-ocr/vision";
import { describe, expect, it } from "vitest";
import { cropInfo } from "./crop-outcome";
import {
  editFromDetection,
  fullImage,
  moveCorner,
  resetToDetected,
  rotateClockwise,
} from "./edit-state";

const quad: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];
const seen = { seen: true };

describe("cropInfo", () => {
  it("is none when detection found no outline and the photo stayed whole", () => {
    const edit = editFromDetection({ quad: null, level: "none" }, null);
    expect(cropInfo(edit, seen)).toEqual({ outcome: "none", level: "none", seen: true });
    expect(cropInfo(rotateClockwise(edit), seen).outcome).toBe("none");
  });

  it("is manual when the user cropped where detection found nothing", () => {
    const edit = editFromDetection({ quad: null, level: "none" }, null);
    expect(cropInfo(moveCorner(edit, 0, { x: 0.2, y: 0.2 }), seen)).toEqual({
      outcome: "manual",
      level: "none",
      seen: true,
    });
  });

  it("is kept for an applied outline, also after a turn", () => {
    const edit = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(edit, seen)).toEqual({ outcome: "kept", level: "apply", seen: true });
    expect(cropInfo(rotateClockwise(edit), seen).outcome).toBe("kept");
  });

  it("is kept when a suggestion was accepted with Reset to detected", () => {
    const suggested = editFromDetection({ quad, level: "suggest" }, null);
    expect(cropInfo(resetToDetected(suggested), seen)).toEqual({
      outcome: "kept",
      level: "suggest",
      seen: true,
    });
  });

  it("is kept again after the outline is restored following an edit", () => {
    const edit = editFromDetection({ quad, level: "apply" }, null);
    const moved = moveCorner(edit, 0, { x: 0.2, y: 0.2 });
    expect(cropInfo(moved, seen).outcome).toBe("adjusted");
    expect(cropInfo(resetToDetected(moved), seen).outcome).toBe("kept");
  });

  it("is adjusted once a corner moves, from an applied outline or a suggestion", () => {
    const applied = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(moveCorner(applied, 0, { x: 0.2, y: 0.2 }), seen)).toEqual({
      outcome: "adjusted",
      level: "apply",
      seen: true,
    });
    const suggested = resetToDetected(editFromDetection({ quad, level: "suggest" }, null));
    expect(cropInfo(moveCorner(suggested, 1, { x: 0.8, y: 0.2 }), seen)).toEqual({
      outcome: "adjusted",
      level: "suggest",
      seen: true,
    });
  });

  it("is adjusted when a crop is drawn from a suggestion that started as the full image", () => {
    const suggested = editFromDetection({ quad, level: "suggest" }, null);
    const drawn = moveCorner(suggested, 0, { x: 0.3, y: 0.3 });
    expect(cropInfo(drawn, seen)).toMatchObject({ outcome: "adjusted", level: "suggest" });
  });

  it("is full_image when the crop is dropped, or a suggestion was never accepted", () => {
    const applied = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(fullImage(applied), seen)).toEqual({
      outcome: "full_image",
      level: "apply",
      seen: true,
    });
    const suggested = editFromDetection({ quad, level: "suggest" }, null);
    expect(cropInfo(suggested, seen)).toEqual({
      outcome: "full_image",
      level: "suggest",
      seen: true,
    });
  });

  it("tells a photo nobody opened from one the user saw, and carries the source", () => {
    const edit = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(edit, { seen: false, source: "camera" })).toEqual({
      outcome: "kept",
      level: "apply",
      seen: false,
      source: "camera",
    });
  });
});
