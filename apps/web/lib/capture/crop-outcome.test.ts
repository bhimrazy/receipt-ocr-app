import type { Quad } from "@receipt-ocr/vision";
import { describe, expect, it } from "vitest";
import { cropInfo } from "./crop-outcome";
import { editFromDetection, fullImage, moveCorner, rotateClockwise } from "./edit-state";

const quad: Quad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
];

describe("cropInfo", () => {
  it("is none when detection found no outline", () => {
    const edit = editFromDetection({ quad: null, level: "none" }, null);
    expect(cropInfo(edit)).toEqual({ outcome: "none", level: "none" });
    expect(cropInfo(rotateClockwise(edit)).outcome).toBe("none");
  });

  it("is kept for an applied outline, also after a turn", () => {
    const edit = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(edit)).toEqual({ outcome: "kept", level: "apply" });
    expect(cropInfo(rotateClockwise(edit)).outcome).toBe("kept");
  });

  it("is adjusted once a corner moves", () => {
    const edit = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(moveCorner(edit, 0, { x: 0.2, y: 0.2 }))).toEqual({
      outcome: "adjusted",
      level: "apply",
    });
  });

  it("is full_image when the crop is dropped, or a suggestion was never accepted", () => {
    const applied = editFromDetection({ quad, level: "apply" }, null);
    expect(cropInfo(fullImage(applied))).toEqual({ outcome: "full_image", level: "apply" });
    const suggested = editFromDetection({ quad, level: "suggest" }, null);
    expect(cropInfo(suggested)).toEqual({ outcome: "full_image", level: "suggest" });
  });
});
