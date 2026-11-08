/** The closed vocabulary of the `install_offer` product event, shared by client and server. */
export const INSTALL_ACTIONS = ["shown", "opened", "accepted", "dismissed", "installed"] as const;
/** `browser`: installed from the browser's own menu, not from one of our surfaces. */
export const INSTALL_SURFACES = ["card", "menu", "settings", "browser"] as const;
export const INSTALL_PLATFORMS = ["chromium", "ios_safari", "ios_chrome", "ios_other"] as const;

export type InstallOfferEvent = {
  action: (typeof INSTALL_ACTIONS)[number];
  surface: (typeof INSTALL_SURFACES)[number];
  platform: (typeof INSTALL_PLATFORMS)[number];
};
