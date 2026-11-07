// Not in app-nav.tsx: that file is a client module, and a server component importing a constant
// from one gets a reference, not the value.
/**
 * Phone tab bar layout, one switch:
 * "five": Home, History, Scan (centred), Groups, Settings.
 * "three": Home, Scan (centred), History. Settings moves into the account sheet and Groups is
 * reached from History.
 */
export type MobileTabs = "five" | "three";
export const MOBILE_TABS = "five" as MobileTabs;
