/** The closed vocabulary of the `upgrade_cta` and `checkout_started` product events, shared by client and server. */

/** `dismissed`: the Home card's or the banner's own "Not now", never closing the modal. */
export const UPGRADE_ACTIONS = ["opened", "dismissed"] as const;
/** Where the modal was opened from. `email` and `link` are the `?upgrade=1` deep link, with and without `via=email`. */
export const UPGRADE_SURFACES = ["home", "meter", "menu", "limit", "banner", "email", "link"] as const;
export const UPGRADE_LEVELS = ["quiet", "near", "at"] as const;
/** Where a checkout started: an upgrade surface, or the billing page's own button. */
export const CHECKOUT_VIAS = [...UPGRADE_SURFACES, "billing"] as const;

export type UpgradeAction = (typeof UPGRADE_ACTIONS)[number];
export type UpgradeSurface = (typeof UPGRADE_SURFACES)[number];
export type UpgradeLevel = (typeof UPGRADE_LEVELS)[number];
export type CheckoutVia = (typeof CHECKOUT_VIAS)[number];

export const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);
