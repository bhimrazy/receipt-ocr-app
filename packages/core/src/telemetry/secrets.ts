export const REDACTED = "[redacted:secret]";

/**
 * Known secret shapes. Prefix patterns match anywhere in the string, so
 * `google:AIza…` is caught too; the hex patterns need a non-alphanumeric
 * boundary so ids that merely contain hex runs are not.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/, // Google / Gemini API key
  /\bsk-[A-Za-z0-9_-]{20,}/, // Anthropic (`sk-ant-`) and OpenAI-style keys
  /(?<![A-Za-z0-9])re_[A-Za-z0-9]{16,}/, // Resend
  /(?<![A-Za-z0-9])(?:[0-9a-f]{32}|[0-9a-f]{64})(?![A-Za-z0-9])/i, // R2/S3 secrets, digests
  /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/, // JWT
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@]+@/i, // connection string with a password
  /\bBearer\s+\S+/i,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bvc[pariks]_[A-Za-z0-9]{20,}/, // Vercel prefixed tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export const isSecretShaped = (value: string): boolean =>
  SECRET_SHAPES.some((re) => re.test(value));
