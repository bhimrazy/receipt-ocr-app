import { GROUP_COLORS, type GroupColor } from "@receipt-ocr/core/group-rules";

/** Literal class names so Tailwind generates them; tokens live in packages/ui styles.css. */
export const GROUP_DOT_CLASS: Record<GroupColor, string> = {
  green: "bg-group-green",
  teal: "bg-group-teal",
  blue: "bg-group-blue",
  violet: "bg-group-violet",
  pink: "bg-group-pink",
  red: "bg-group-red",
  orange: "bg-group-orange",
  yellow: "bg-group-yellow",
};

export const GROUP_COLOR_LABEL: Record<GroupColor, string> = {
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  violet: "Violet",
  pink: "Pink",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
};

/** A colour for a new group: the next one round the palette, so neighbours differ. */
export function nextGroupColor(existing: number): GroupColor {
  return GROUP_COLORS[existing % GROUP_COLORS.length]!;
}

export { GROUP_COLORS, type GroupColor };
