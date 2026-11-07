import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FULL_QUAD, initialEdit, type EditState } from "./edit-state";
import { EditFailedError, preparePhoto } from "./prepare-photo";

const prepareFile = vi.hoisted(() => vi.fn(async (file: File) => file));
vi.mock("@/lib/upload-prep", () => ({ prepareFile }));

type FakeCanvas = {
  width: number;
  height: number;
  getContext: () => unknown;
  toBlob: (done: (blob: Blob | null) => void) => void;
};

/** A stand-in canvas: `context` false means no 2D context, `blob` false means toBlob fails. */
function stubCanvas({ context = true, blob = true }: { context?: boolean; blob?: boolean }) {
  const canvases: FakeCanvas[] = [];
  const ctx = { translate() {}, rotate() {}, drawImage() {} };
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected <${tag}>`);
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => (context ? ctx : null),
        toBlob: (done) =>
          done(blob ? new Blob([new Uint8Array(10)], { type: "image/jpeg" }) : null),
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return canvases;
}

function stubDecode(fails = false) {
  const bitmap = { width: 400, height: 300, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (fails) throw new DOMException("cannot decode", "InvalidStateError");
      return bitmap;
    }),
  );
  return bitmap;
}

const photo = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
  name: "receipt.jpg",
};
const rotated: EditState = { ...initialEdit(), rotation: 90 };
const unedited = initialEdit();
const noStartingEdit = () => {
  throw new Error("starting edit should not be needed");
};

/** Whether any call to prepareFile was handed the photo as taken. */
const sentOriginal = () =>
  prepareFile.mock.calls.some(
    ([file]) => file.size === photo.blob.size && file.name === photo.name,
  );

beforeEach(() => prepareFile.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("preparePhoto", () => {
  it("uploads the rendered edit", async () => {
    const canvases = stubCanvas({});
    stubDecode();
    const file = await preparePhoto(photo, rotated, noStartingEdit);
    expect(file.type).toBe("image/jpeg");
    expect(file.size).toBe(10);
    expect(sentOriginal()).toBe(false);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("never sends the original of an edited photo when the encode fails", async () => {
    const canvases = stubCanvas({ blob: false });
    const bitmap = stubDecode();
    await expect(preparePhoto(photo, rotated, noStartingEdit)).rejects.toBeInstanceOf(
      EditFailedError,
    );
    expect(prepareFile).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalled();
    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("never sends the original of an edited photo when there is no 2D context", async () => {
    stubCanvas({ context: false });
    stubDecode();
    const cropped: EditState = {
      ...unedited,
      quad: [FULL_QUAD[0], { x: 0.8, y: 0 }, { x: 0.8, y: 1 }, FULL_QUAD[3]],
    };
    await expect(preparePhoto(photo, cropped, noStartingEdit)).rejects.toBeInstanceOf(
      EditFailedError,
    );
    await expect(
      preparePhoto(photo, { ...unedited, filter: "bw" }, noStartingEdit),
    ).rejects.toThrow(EditFailedError);
    expect(prepareFile).not.toHaveBeenCalled();
  });

  it("sends an unedited photo as it is when the encode fails", async () => {
    stubCanvas({ blob: false });
    stubDecode();
    await preparePhoto(photo, unedited, noStartingEdit);
    expect(sentOriginal()).toBe(true);
  });

  it("sends the original when the browser can't decode it", async () => {
    stubCanvas({});
    stubDecode(true);
    await preparePhoto(photo, rotated, noStartingEdit);
    expect(sentOriginal()).toBe(true);
  });

  it("builds the starting edit for a photo that was never opened", async () => {
    stubCanvas({ blob: false });
    stubDecode();
    const startingEdit = vi.fn(() => rotated);
    await expect(preparePhoto(photo, undefined, startingEdit)).rejects.toBeInstanceOf(
      EditFailedError,
    );
    expect(startingEdit).toHaveBeenCalledOnce();
    expect(prepareFile).not.toHaveBeenCalled();
  });
});
