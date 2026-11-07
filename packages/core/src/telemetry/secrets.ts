export const REDACTED = "[redacted:secret]";

/**
 * Known secret shapes. Prefix patterns match anywhere in the string, so
 * `google:AIza…` is caught too; the hex patterns need a non-alphanumeric
 * boundary so ids that merely contain hex runs are not.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/, // Google / Gemini API key
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/, // Anthropic (`sk-ant-`) and OpenAI-style keys
  /(?<![A-Za-z0-9])gsk_[A-Za-z0-9]{20,}/, // Groq
  /(?<![A-Za-z0-9])re_[A-Za-z0-9]{16,}/, // Resend
  /(?<![A-Za-z0-9])(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})(?![A-Za-z0-9])/i, // R2/S3 secrets, GitHub client secret, digests
  /eyJ[A-Za-z0-9_-]{4,200}\.[A-Za-z0-9_-]{4,200}\.[A-Za-z0-9_-]{0,200}/, // JWT
  /postgres(?:ql)?:\/\/[^\s:@/]{1,100}:[^\s@]{1,200}@/i, // connection string with a password
  /\bBearer\s+\S+/i,
  /GOCSPX-[A-Za-z0-9_-]{20,}/, // Google OAuth client secret
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{30,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bvc[pariks]_[A-Za-z0-9]{20,}/, // Vercel prefixed tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export const isSecretShaped = (value: string): boolean =>
  SECRET_SHAPES.some((re) => re.test(value));
