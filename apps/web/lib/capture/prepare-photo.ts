import { prepareFile } from "@/lib/upload-prep";
import { isFullFrame, type EditState } from "./edit-state";
import { loadImage, renderToJpeg } from "./render";

/** A reviewed photo that could not be turned into an upload; it is held back, not sent. */
export class EditFailedError extends Error {
  constructor(cause: unknown) {
    super("This photo's edit couldn't be saved", { cause });
    this.name = "EditFailedError";
  }
}

/** True when the upload would look like the photo as taken: no crop, turn or filter. */
export const isUnedited = (edit: EditState) =>
  isFullFrame(edit.quad) && edit.rotation === 0 && edit.filter === "original";

/**
 * The file to upload for one reviewed photo. `edit` is what the user saw, or `startingEdit`
 * builds it for a photo they never opened.
 *
 * - The browser can't decode it (HEIC outside Safari): the original goes, and the server judges
 *   it like any upload. Nothing was shown, so nothing is lost.
 * - It decodes but the edit can't be rendered or encoded (canvas memory, no 2D context): an
 *   unedited photo still goes as it is; an edited one throws `EditFailedError`, because sending
 *   the original would silently drop the crop, rotation and filter the user chose.
 */
export async function preparePhoto(
  image: { blob: Blob; name: string },
  edit: EditState | undefined,
  startingEdit: (bitmap: ImageBitmap) => EditState,
): Promise<File> {
  const original = () => prepareFile(new File([image.blob], image.name, { type: image.blob.type }));
  let bitmap: ImageBitmap;
  try {
    bitmap = await loadImage(image.blob);
  } catch {
    return original();
  }
  let chosen = edit;
  try {
    chosen ??= startingEdit(bitmap);
    return await prepareFile(await renderToJpeg(bitmap, chosen, image.name));
  } catch (error) {
    if (!chosen || isUnedited(chosen)) return original();
    throw new EditFailedError(error);
  } finally {
    bitmap.close();
  }
}
