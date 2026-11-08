// Precached with offline.html by sw.js. Loaded in <head>, so the theme is set before paint;
// the same rules as THEME_SCRIPT in lib/theme-script.ts (a stored choice, else the OS).
try {
  const stored = localStorage.getItem("theme");
  const light =
    stored === "light" ||
    (stored !== "dark" && matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.classList.toggle("light", light);
} catch {
  // Storage blocked: stay dark.
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("retry").addEventListener("click", () => location.reload());
});
window.addEventListener("online", () => location.reload());
