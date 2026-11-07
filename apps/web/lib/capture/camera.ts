/**
 * Camera access for the in-app capture sheet. Frames stay in memory on the device until the
 * user uploads them.
 */

export type CameraSupport = "ok" | "insecure" | "unsupported";

/** Whether getUserMedia can work here. Plain HTTP (other than localhost) never gets a camera. */
export function cameraSupport(env: {
  isSecureContext?: boolean;
  mediaDevices?: { getUserMedia?: unknown };
}): CameraSupport {
  if (env.isSecureContext === false) return "insecure";
  return typeof env.mediaDevices?.getUserMedia === "function" ? "ok" : "unsupported";
}

export function browserCameraSupport(): CameraSupport {
  if (typeof window === "undefined") return "unsupported";
  return cameraSupport({
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
  });
}

/** True when there is at least one camera. Before permission, browsers list it without a label. */
export async function hasCamera(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
}

/** Installed to the home screen. iOS reports it through `navigator.standalone`. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export type CameraProblem =
  "denied" | "missing" | "busy" | "insecure" | "unsupported" | "ended" | "failed";

export function cameraProblem(error: unknown): CameraProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    case "SecurityError":
      return "insecure";
    case "TypeError":
      return "unsupported";
    default:
      return "failed";
  }
}

export function cameraProblemMessage(problem: CameraProblem, standalone: boolean): string {
  switch (problem) {
    case "denied":
      return standalone
        ? "Camera access is off for this app. Allow it in your phone's settings, or use your phone's camera app instead."
        : "Camera access was blocked. Allow it in your browser's site settings, or use your phone's camera app instead.";
    case "missing":
      return "No camera was found on this device.";
    case "busy":
      return "The camera is in use by another app. Close that app and try again.";
    case "insecure":
      return "The camera only works over a secure (https) connection.";
    case "unsupported":
      return "This browser can't open the camera here. Use your phone's camera app instead.";
    case "ended":
      return "The camera stopped. Try again, or use your phone's camera app instead.";
    default:
      return "The camera didn't start. Try again, or use your phone's camera app instead.";
  }
}

/**
 * The back camera at the highest resolution it offers (ideal values never fail; the browser
 * picks the closest). Retries with any camera when the constraints can't be met.
 */
export async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 4096 },
        height: { ideal: 4096 },
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "OverconstrainedError") {
      return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    }
    throw error;
  }
}

export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

export function torchSupported(track: MediaStreamTrack | undefined): boolean {
  const caps = track?.getCapabilities?.() as TorchCapabilities | undefined;
  return caps?.torch === true;
}

export async function setTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export const CAPTURE_JPEG_QUALITY = 0.92;

/** The current video frame at full sensor resolution, as a JPEG with no metadata. */
export async function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx || !canvas.width) throw new Error("camera not ready");
    ctx.drawImage(video, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("capture failed"))),
        "image/jpeg",
        CAPTURE_JPEG_QUALITY,
      ),
    );
  } finally {
    // A 12 MP frame holds ~48 MB until garbage collection otherwise.
    canvas.width = canvas.height = 0;
  }
}
