"use client";

import { useEffect } from "react";
import { watchTheme } from "@/lib/theme";

/**
 * Follows the OS scheme while on System and choices made in other tabs. THEME_SCRIPT sets the
 * theme before paint; this only keeps it current, so it renders nothing and provides no context.
 */
export function ThemeProvider() {
  useEffect(() => watchTheme(), []);
  return null;
}
