import { pixelBasedPreset, type TailwindConfig } from "react-email";

/**
 * Email palette. The accent, dark surfaces and font stacks come from packages/ui/src/styles.css;
 * the app is dark-only, so the light neutrals are Tailwind's zinc scale, which the dark ones
 * already follow. Mail is light-first: Gmail and Outlook apps invert light designs predictably,
 * while a forced-dark design turns muddy (Litmus, "The ultimate guide to dark mode").
 * Pairs used for text are WCAG AA (>= 4.5:1) on their surface.
 */
export const colors = {
  canvas: "#f4f4f5", // zinc-100
  surface: "#ffffff",
  line: "#e4e4e7", // zinc-200
  ink: "#18181b", // zinc-900, 17.7:1 on surface
  body: "#3f3f46", // zinc-700, 10.4:1
  muted: "#63636b", // 6.0:1 on surface, 5.5:1 on canvas
  /** ui --cta: white text 5.5:1; as link text 5.5:1 on surface. */
  accent: "#047857",
  accentForeground: "#ffffff",
  /** Destructive actions (delete account): red-700, white text 6.5:1. */
  danger: "#b91c1c",
  dangerForeground: "#ffffff",
  dark: {
    canvas: "#0a0a0b", // ui --background
    surface: "#141416", // ui --card
    line: "#27272a", // ui --border
    ink: "#fafafa", // ui --accent-foreground
    body: "#e4e4e7", // ui --foreground
    muted: "#9a9aa3", // ui --muted-foreground, 6.6:1 on surface
    accent: "#34d399", // ui --primary, 10.6:1 on surface
    accentForeground: "#07110d", // ui --primary-foreground, 10.0:1 on accent
    danger: "#f87171", // ui --destructive
    dangerForeground: "#1a0606", // ui --destructive-foreground, 7.1:1 on danger
  },
} as const;

export const fonts = {
  // DM Sans is the app face; mail clients that lack it fall back to the system UI font.
  sans: [
    '"DM Sans"',
    "-apple-system",
    "BlinkMacSystemFont",
    '"Segoe UI"',
    "Roboto",
    "Helvetica",
    "Arial",
    "sans-serif",
  ],
  mono: ['"JetBrains Mono"', '"SFMono-Regular"', "Consolas", "Menlo", "monospace"],
};

export const tailwindConfig: TailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      colors: {
        canvas: colors.canvas,
        surface: colors.surface,
        line: colors.line,
        ink: colors.ink,
        body: colors.body,
        muted: colors.muted,
        accent: colors.accent,
        "accent-fg": colors.accentForeground,
        danger: colors.danger,
        "danger-fg": colors.dangerForeground,
        "d-canvas": colors.dark.canvas,
        "d-surface": colors.dark.surface,
        "d-line": colors.dark.line,
        "d-ink": colors.dark.ink,
        "d-body": colors.dark.body,
        "d-muted": colors.dark.muted,
        "d-accent": colors.dark.accent,
        "d-accent-fg": colors.dark.accentForeground,
        "d-danger": colors.dark.danger,
        "d-danger-fg": colors.dark.dangerForeground,
      },
      fontFamily: { sans: fonts.sans, mono: fonts.mono },
    },
  },
};
