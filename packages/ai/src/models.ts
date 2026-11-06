/**
 * Models an admin may put in the OCR chain. An allowlist, not free text: a
 * typo in a model id would only show up as failed receipts. Add an entry here
 * (and a price in bench/prices.json) to offer another model.
 */

export type OcrProviderId = "google" | "fixture";

export interface OcrProvider {
  id: OcrProviderId;
  label: string;
  /** Env var holding the API key; null for providers that need none. */
  keyEnv: string | null;
}

export interface OcrModel {
  id: `${OcrProviderId}:${string}` | "fixture";
  provider: OcrProviderId;
  label: string;
}

export const OCR_PROVIDERS: readonly OcrProvider[] = [
  { id: "google", label: "Google Gemini", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
  // Deterministic offline stand-in; only offered when OCR_PROVIDER=fixture (tests, local).
  { id: "fixture", label: "Offline fixture", keyEnv: null },
];

export const OCR_MODELS: readonly OcrModel[] = [
  { id: "google:gemini-3.7-flash", provider: "google", label: "Gemini 3.7 Flash" },
  { id: "fixture", provider: "fixture", label: "Fixture receipts (no network)" },
];

export function ocrModel(id: string): OcrModel | undefined {
  return OCR_MODELS.find((model) => model.id === id);
}
