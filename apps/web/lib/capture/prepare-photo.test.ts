import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editFromDetection, FULL_QUAD, initialEdit, type EditState } from "./edit-state";
import { TooLargeError } from "@/lib/upload-encoding";
import { EditFailedError, preparePhoto } from "./prepare-photo";

const prepareFile = vi.hoisted(() =>
  vi.fn<(file: File, options?: unknown) => Promise<File>>(async (file) => file),
);
/** Encodes the canvas it is handed, like the real one, so a failing `toBlob` fails it. */
const encodeUpload = vi.hoisted(() =>
  vi.fn<(canvas: FakeCanvas, name: string, options?: unknown) => Promise<File>>(
    (canvas, name) =>
      new Promise<File>((resolve, reject) =>
        canvas.toBlob((blob) =>
          blob
            ? resolve(new File([blob], name, { type: "image/jpeg" }))
            : reject(new Error("encode failed")),
        ),
      ),
  ),
);
vi.mock("@/lib/upload-prep", () => ({ prepareFile, encodeUpload }));

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

beforeEach(() => {
  prepareFile.mockClear();
  encodeUpload.mockClear();
});
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

  it("passes the chosen upload size on, for the edit and for the original", async () => {
    stubCanvas({});
    stubDecode();
    await preparePhoto(photo, rotated, noStartingEdit, "larger");
    expect(encodeUpload).toHaveBeenLastCalledWith(expect.anything(), "receipt.jpg", {
      size: "larger",
      filter: "original",
    });
    stubDecode(true);
    await preparePhoto(photo, undefined, noStartingEdit, "smaller");
    expect(prepareFile).toHaveBeenLastCalledWith(expect.any(File), { size: "smaller" });
  });

  it("refuses a photo that stays over the hard cap instead of sending the original", async () => {
    const canvases = stubCanvas({});
    stubDecode();
    encodeUpload.mockRejectedValueOnce(new TooLargeError(2_000_000));
    await expect(preparePhoto(photo, unedited, noStartingEdit)).rejects.toBeInstanceOf(
      TooLargeError,
    );
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

  it("sends the original of an unedited or never-opened photo the browser can't decode", async () => {
    stubCanvas({});
    stubDecode(true);
    await preparePhoto(photo, undefined, noStartingEdit);
    expect(sentOriginal()).toBe(true);
    prepareFile.mockClear();
    await preparePhoto(photo, unedited, noStartingEdit);
    expect(sentOriginal()).toBe(true);
  });

  it("never sends the original of an edited photo whose decode fails at Read", async () => {
    stubCanvas({});
    stubDecode(true);
    await expect(preparePhoto(photo, rotated, noStartingEdit)).rejects.toBeInstanceOf(
      EditFailedError,
    );
    expect(prepareFile).not.toHaveBeenCalled();
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

  it("uploads a never-opened photo uncropped when the outline is only a suggestion", async () => {
    stubCanvas({});
    stubDecode();
    let size = "";
    encodeUpload.mockImplementationOnce(async (canvas, name) => {
      size = `${canvas.width}x${canvas.height}`;
      return new File([new Uint8Array(10)], name, { type: "image/jpeg" });
    });
    const outline: EditState["quad"] = [
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 0.25, y: 0.9 },
    ];
    await preparePhoto(photo, undefined, () =>
      editFromDetection({ quad: outline, level: "suggest" }, null),
    );
    expect(size).toBe("400x300");
    expect(encodeUpload).toHaveBeenLastCalledWith(expect.anything(), "receipt.jpg", {
      size: undefined,
      filter: "original",
    });
  });
});
