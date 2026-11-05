export const WORKSPACE_NAME_MAX_LENGTH = 80;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Workspace names reach invitation mail and every member's UI, so they are
 * plain text: trimmed, 1–80 characters, no angle brackets or control characters.
 */
export function parseWorkspaceName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Workspace name is required." };
  const name = raw.trim();
  if (!name) return { ok: false, error: "Workspace name is required." };
  if (name.length > WORKSPACE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Workspace name must be ${WORKSPACE_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (/[<>]/.test(name) || CONTROL.test(name)) {
    return { ok: false, error: "Workspace name can't contain < > or control characters." };
  }
  return { ok: true, name };
}

const SUFFIX = "'s Workspace";

/** "<name>'s Workspace" from a user's display name, cleaned to pass `parseWorkspaceName`. */
export function personalWorkspaceName(user: { name?: string | null; email: string }): string {
  const source = user.name?.trim() || user.email.split("@")[0] || "Personal";
  const owner =
    source
      // eslint-disable-next-line no-control-regex
      .replace(/[<>\u0000-\u001f\u007f-\u009f]/g, "")
      .trim()
      .slice(0, WORKSPACE_NAME_MAX_LENGTH - SUFFIX.length)
      .trim() || "Personal";
  return `${owner}${SUFFIX}`;
}
