import "server-only";
import type { z } from "zod";
import { jsonError } from "./http";

/** Group and membership bodies are a few ids and a name; anything bigger is not ours. */
const MAX_JSON_BYTES = 16 * 1024;

/** The body's bytes, or null once it passes the limit; stops reading at that point. */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/**
 * Reads a small JSON body and validates it with `schema`. Returns the parsed
 * value, or the 400/413 response to send. `limit` is in bytes.
 */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T, unknown>,
  limit = MAX_JSON_BYTES,
): Promise<{ data: T } | { response: Response }> {
  if (Number(request.headers.get("content-length") ?? "") > limit) {
    return { response: jsonError(413, "Request body too large") };
  }
  let text: string;
  try {
    const bytes = await readCapped(request, limit);
    if (!bytes) return { response: jsonError(413, "Request body too large") };
    text = new TextDecoder().decode(bytes);
  } catch {
    return { response: jsonError(400, "Invalid request body") };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { response: jsonError(400, "Invalid request body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body") };
  }
  return { data: parsed.data };
}

/** Receipt edits and contact messages: a few short fields, so 64 KB is generous. */
export const MAX_FORM_JSON_BYTES = 64 * 1024;
