import {
  Briefcase,
  Building2,
  Calculator,
  CalendarRange,
  Camera,
  Crown,
  FileSpreadsheet,
  FolderPlus,
  Receipt,
  SearchCheck,
  Tags,
  User,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ContentIconName } from "@/lib/content/types";

/** The icon for each name content data may use. */
export const CONTENT_ICONS: Record<ContentIconName, LucideIcon> = {
  briefcase: Briefcase,
  building: Building2,
  calculator: Calculator,
  "calendar-range": CalendarRange,
  camera: Camera,
  crown: Crown,
  "file-spreadsheet": FileSpreadsheet,
  "folder-plus": FolderPlus,
  receipt: Receipt,
  "search-check": SearchCheck,
  tags: Tags,
  user: User,
  "user-cog": UserCog,
  users: Users,
};
