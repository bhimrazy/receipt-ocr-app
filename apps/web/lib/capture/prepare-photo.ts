import { TooLargeError } from "@/lib/upload-encoding";
import { encodeUpload, prepareFile, type SizeId } from "@/lib/upload-prep";
import { cropInfo } from "./crop-outcome";
import { isFullFrame, type EditState } from "./edit-state";
import { FULL_RENDER, loadImage, releaseCanvas, renderEdit } from "./render";

/** A reviewed photo that could not be turned into an upload; it is held back, not sent. */
export class EditFailedError extends Error {
  constructor(cause: unknown) {
    super("This photo's edit couldn't be saved", { cause });
    this.name = "EditFailedError";
  }
}

/** True when the upload would look like the photo as taken: no crop, turn or filter. */
const isUnedited = (edit: EditState) =>
  isFullFrame(edit.quad) && edit.rotation === 0 && edit.filter === "original";

/**
 * The file to upload for one reviewed photo. `edit` is what the user saw, or `startingEdit`
 * builds it for a photo they never opened. The rendered edit is encoded directly, at the upload
 * size picked in review (`size`, see `encodeUpload`).
 *
 * - The browser can't decode it (HEIC outside Safari): the original goes, and the server judges
 *   it like any upload, unless the user edited it (it decoded in review, then failed here, e.g.
 *   out of memory).
 * - It decodes but the edit can't be rendered or encoded (canvas memory, no 2D context): an
 *   unedited photo still goes as it is.
 *
 * An edited photo that fails either way throws `EditFailedError`: sending the original would
 * silently drop the crop, rotation and filter the user chose. A photo that can't be brought under
 * the hard cap throws `TooLargeError`.
 */
export async function preparePhoto(
  image: { blob: Blob; name: string },
  edit: EditState | undefined,
  startingEdit: (bitmap: ImageBitmap) => EditState,
  size?: SizeId,
): Promise<File> {
  const original = () =>
    prepareFile(new File([image.blob], image.name, { type: image.blob.type }), { size });
  let bitmap: ImageBitmap;
  try {
    bitmap = await loadImage(image.blob);
  } catch (error) {
    if (edit && !isUnedited(edit)) throw new EditFailedError(error);
    return original();
  }
  let chosen = edit;
  let canvas: HTMLCanvasElement | undefined;
  try {
    chosen ??= startingEdit(bitmap);
    canvas = renderEdit(bitmap, chosen, FULL_RENDER);
    return await encodeUpload(canvas, image.name, {
      size,
      filter: chosen.filter,
      crop: cropInfo(chosen),
    });
  } catch (error) {
    if (error instanceof TooLargeError) throw error;
    if (!chosen || isUnedited(chosen)) return original();
    throw new EditFailedError(error);
  } finally {
    if (canvas) releaseCanvas(canvas);
    bitmap.close();
  }
}
