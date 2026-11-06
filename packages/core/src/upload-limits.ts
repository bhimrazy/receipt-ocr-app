/** Upload limits shared by the server (validateUpload) and the browser (upload panel). No runtime imports. */

/** What the app accepts for one receipt file. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Largest request body the deployment accepts. Vercel rejects bodies over 4.5 MB with a 413; this is that limit
 * minus room for the multipart envelope. Self-hosted (Docker) deployments are only bound by MAX_UPLOAD_BYTES,
 * but the browser applies this one everywhere. See docs/deployment.md.
 */
export const DEPLOYMENT_BODY_LIMIT_BYTES = 4_400_000;

export const ACCEPTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number];
