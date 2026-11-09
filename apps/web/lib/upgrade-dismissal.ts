import { z } from "zod";
import type { UpgradeLevel } from "./upgrade-event";

/**
 * Which upgrade offers the person hid, kept in an httpOnly cookie so the server leaves a hidden
 * one out (no flash). Listed on /cookies. Times are epoch milliseconds.
 */
export const UPGRADE_COOKIE = "receiptocr.upgrade";
export const UPGRADE_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const QUIET_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
/** The second "Not now" on the quiet Home card hides it for good. */
const QUIET_DISMISSALS_FOR_GOOD = 2;

const schema = z.object({
  home: z
    .object({
      quietDismissals: z.number().int().min(0).max(100),
      until: z.number(),
      level: z.enum(["quiet", "near"]),
    })
    .optional(),
  banner: z.object({ until: z.number() }).optional(),
});

export type Dismissals = z.infer<typeof schema>;

/** The stored state; empty for a missing, malformed or tampered cookie. */
export function parseDismissals(raw: string | undefined): Dismissals {
  if (!raw) return {};
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Whether the Home card at `level` stays hidden. A quiet dismissal never hides `near`, and
 * nothing hides the at-limit state (Home shows no card then anyway).
 */
export function homeDismissed(state: Dismissals, level: UpgradeLevel, now: number): boolean {
  const home = state.home;
  if (!home || level === "at") return false;
  if (level === "quiet")
    return home.quietDismissals >= QUIET_DISMISSALS_FOR_GOOD || home.until > now;
  return home.level === "near" && home.until > now;
}

/** The banner stays hidden until the window it was dismissed in reopens. */
export const bannerDismissed = (state: Dismissals, now: number) =>
  state.banner !== undefined && state.banner.until > now;

/**
 * The state after a "Not now". Home quiet: 30 days, then for good the second time. Home near:
 * until the allowance resets. Banner: until uploads open again.
 */
export function dismiss(
  state: Dismissals,
  surface: "home" | "banner",
  level: UpgradeLevel,
  usage: { resetsAt: Date; opensAt: Date },
  now: number,
): Dismissals {
  if (surface === "banner") return { ...state, banner: { until: usage.opensAt.getTime() } };
  const quietDismissals = state.home?.quietDismissals ?? 0;
  if (level === "quiet") {
    return {
      ...state,
      home: { quietDismissals: quietDismissals + 1, until: now + QUIET_SNOOZE_MS, level: "quiet" },
    };
  }
  return { ...state, home: { quietDismissals, until: usage.resetsAt.getTime(), level: "near" } };
}
