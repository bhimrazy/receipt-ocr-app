import "server-only";
import { parseGaMeasurementId } from "./config";

/**
 * Read on the server only and handed to the client as a prop, so a mistyped value never reaches
 * the bundle; only a valid id does. Fixed at build time (static pages and the CSP header both
 * come from the build).
 */
export const gaMeasurementId = parseGaMeasurementId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);

/** Same rule as the Turnstile widget, which is inlined at build time. */
export const turnstileOn = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
