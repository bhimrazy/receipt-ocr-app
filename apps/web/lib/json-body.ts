import "server-only";
import type { z } from "zod";
import { jsonError } from "./http";

/** Group and membership bodies are a few ids and a name; anything bigger is not ours. */
const MAX_JSON_BYTES = 16 * 1024;

/**
 * Reads a small JSON body and validates it with `schema`. Returns the parsed
 * value, or the 400/413 response to send.
 */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T, unknown>,
): Promise<{ data: T } | { response: Response }> {
  if (Number(request.headers.get("content-length") ?? "") > MAX_JSON_BYTES) {
    return { response: jsonError(413, "Request body too large") };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { response: jsonError(400, "Invalid request body") };
  }
  if (text.length > MAX_JSON_BYTES) return { response: jsonError(413, "Request body too large") };
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
