export const OTP_LENGTH = 6;

/** Keeps digits only, at most `OTP_LENGTH`. */
export function sanitizeOtp(text: string): string {
  return text.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

/** `complete` is true only on the edit that fills the last box, so a caller submits once. */
export function applyInput(prev: string, raw: string): { value: string; complete: boolean } {
  const value = sanitizeOtp(raw);
  return { value, complete: value.length === OTP_LENGTH && prev.length !== OTP_LENGTH };
}

/** Pasting a whole code replaces everything; shorter text is spliced over the selection. */
export function applyPaste(
  prev: string,
  start: number,
  end: number,
  text: string,
): { value: string; caret: number; complete: boolean } {
  const digits = text.replace(/\D/g, "");
  if (!digits) return { value: prev, caret: start, complete: false };
  if (digits.length >= OTP_LENGTH) {
    const value = digits.slice(0, OTP_LENGTH);
    return { value, caret: OTP_LENGTH, complete: prev !== value || prev.length !== OTP_LENGTH };
  }
  const value = sanitizeOtp(prev.slice(0, start) + digits + prev.slice(end));
  return {
    value,
    caret: Math.min(start + digits.length, value.length),
    complete: value.length === OTP_LENGTH && prev.length !== OTP_LENGTH,
  };
}

/** A full code has no room for typing, so a digit replaces the one under the caret. */
export function overwriteDigit(
  value: string,
  caret: number,
  digit: string,
): { value: string; caret: number } | null {
  if (value.length !== OTP_LENGTH || caret >= OTP_LENGTH || !/^\d$/.test(digit)) return null;
  return { value: value.slice(0, caret) + digit + value.slice(caret + 1), caret: caret + 1 };
}

/** The box a tap at `x` (0 to `width`) lands on, never past the next empty one. */
export function boxAt(x: number, width: number, length: number): number {
  if (width <= 0) return length;
  const index = Math.floor((x / width) * OTP_LENGTH);
  return Math.max(0, Math.min(index, length, OTP_LENGTH - 1));
}
