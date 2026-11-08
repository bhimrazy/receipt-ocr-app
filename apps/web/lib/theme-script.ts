/** localStorage key for the theme preference: "light" or "dark"; missing means System. */
export const THEME_STORAGE_KEY = "theme";

/** `--background` per theme, for the browser chrome (`theme-color`). */
export const THEME_COLORS = { dark: "#0a0a0b", light: "#f7f7f8" } as const;

/** Marks the theme-color meta that pins an explicit choice over the per-scheme ones. */
export const THEME_OVERRIDE_ATTR = "data-theme-override";

/**
 * Runs as the first child of <head>, before the first paint, so there is no flash of the wrong
 * theme. A stored "light" or "dark" wins; otherwise the OS decides (System). Any failure
 * (storage blocked) leaves dark, the no-JS default. `lib/theme.ts` applies the same rules later.
 *
 * An explicit choice prepends its own theme-color meta: the browser uses the first match in
 * document order, and React leaves extra <head> elements alone when it hydrates.
 *
 * Inline, so it runs under today's report-only `script-src 'unsafe-inline'`. When `script-src` is
 * enforced, allow it by the hash of this exact string.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),e=t==="light"||t==="dark",l=t==="light"||(!e&&matchMedia("(prefers-color-scheme: light)").matches),d=document.documentElement;d.classList.toggle("light",l);d.style.colorScheme=l?"light":"dark";if(e){var m=document.createElement("meta");m.name="theme-color";m.setAttribute(${JSON.stringify(THEME_OVERRIDE_ATTR)},"");m.content=l?${JSON.stringify(THEME_COLORS.light)}:${JSON.stringify(THEME_COLORS.dark)};document.head.prepend(m)}}catch(e){}})()`;
