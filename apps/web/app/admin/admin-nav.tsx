"use client";

import {
  Activity,
  Building2,
  ListChecks,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { BottomTabBar, SidebarNav, type NavItem } from "@/components/app-nav";

// Defined here, not in the server layout: icon components can't cross the server/client boundary.
export const SECTIONS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/admin/operations", label: "Operations", icon: Activity },
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/jobs", label: "Jobs", icon: ListChecks },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal },
];

export function AdminSidebarNav() {
  return <SidebarNav items={SECTIONS} label="Admin" />;
}

/** Phone tab bars hold five slots: four sections and More, which holds the rest. */
export const TAB_SECTIONS = SECTIONS.slice(0, 4);
export const MORE_SECTIONS = SECTIONS.slice(4);

export function AdminTabBar() {
  return <BottomTabBar items={TAB_SECTIONS} label="Admin" more={MORE_SECTIONS} />;
}
