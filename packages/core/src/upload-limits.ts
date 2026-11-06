/** Upload limits shared by the server (validateUpload) and the browser (upload panel). No runtime imports. */

/** What the app accepts for one receipt file. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Most pages a PDF may have. Each page costs model input tokens, and receipts and invoices are
 * a page or two; longer documents are usually statements. Checked before anything is stored.
 */
export const MAX_PDF_PAGES = 10;

/**
 * Largest request body the deployment accepts. Vercel rejects bodies over 4.5 MB with a 413; this is that limit
 * with room for the multipart envelope. Self-hosted (Docker) deployments are only bound by MAX_UPLOAD_BYTES,
 * but the browser applies this one everywhere; raising it means editing this constant and rebuilding. See docs/deployment.md.
 */
export const DEPLOYMENT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export type AcceptedMediaType = (typeof ACCEPTED_MEDIA_TYPES)[number];
