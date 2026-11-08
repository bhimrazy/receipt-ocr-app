import { THEME_COLORS, THEME_OVERRIDE_ATTR, THEME_STORAGE_KEY } from "./theme-script";

export type ThemePreference = "system" | "light" | "dark";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

/** The stored choice; "system" when none is stored or storage is blocked. */
export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Whether a preference shows light, given whether the OS prefers light. */
export function resolvesToLight(preference: ThemePreference, systemLight: boolean) {
  return preference === "light" || (preference === "system" && systemLight);
}

/**
 * Puts the page in the theme `preference` resolves to, as THEME_SCRIPT does on load. Transitions
 * are off for that frame so every surface switches at once.
 */
export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  const light = resolvesToLight(preference, matchMedia(LIGHT_QUERY).matches);
  root.setAttribute("data-theme-switching", "");
  root.classList.toggle("light", light);
  root.style.colorScheme = light ? "light" : "dark";
  document.head.querySelector(`meta[name="theme-color"][${THEME_OVERRIDE_ATTR}]`)?.remove();
  if (preference !== "system") {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.setAttribute(THEME_OVERRIDE_ATTR, "");
    meta.content = light ? THEME_COLORS.light : THEME_COLORS.dark;
    document.head.prepend(meta);
  }
  requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
}

const listeners = new Set<() => void>();

/** Stores the choice ("system" clears it), applies it and tells subscribed toggles. */
export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: this tab's changes and other tabs' (the `storage` event). */
export function subscribeThemePreference(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Keeps the page in step after load: the OS switching scheme while on System, and a choice made
 * in another tab. Returns the cleanup.
 */
export function watchTheme() {
  const media = matchMedia(LIGHT_QUERY);
  const sync = () => applyTheme(readThemePreference());
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) sync();
  };
  const onMedia = () => {
    if (readThemePreference() === "system") sync();
  };
  media.addEventListener("change", onMedia);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onMedia);
    window.removeEventListener("storage", onStorage);
  };
}
