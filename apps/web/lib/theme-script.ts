/** localStorage key for the theme preference. */
export const THEME_STORAGE_KEY = "theme";

/** `--background` per theme, for the browser chrome (`theme-color`). */
export const THEME_COLORS = { dark: "#0a0a0b", light: "#f7f7f8" } as const;

/**
 * Runs as the first child of <head>, before the first paint, so there is no flash of the wrong
 * theme. Dark is the default (no class); only an explicit `localStorage.theme = "light"` switches
 * to light, so nobody sees light until a toggle exists. Any failure (storage blocked) leaves dark.
 *
 * The theme-color meta is prepended rather than edited: the browser uses the first match in
 * document order, and React leaves extra <head> elements alone when it hydrates.
 *
 * Inline, so it runs under today's report-only `script-src 'unsafe-inline'`. When `script-src` is
 * enforced, allow it by the hash of this exact string.
 */
export const THEME_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})!=="light")return;var d=document.documentElement;d.classList.add("light");d.style.colorScheme="light";var m=document.createElement("meta");m.name="theme-color";m.content=${JSON.stringify(THEME_COLORS.light)};document.head.prepend(m)}catch(e){}})()`;
