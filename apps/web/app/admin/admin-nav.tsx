"use client";

import {
  Activity,
  Building2,
  LayoutDashboard,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { BottomTabBar, SidebarNav, type NavItem } from "@/components/app-nav";

// Defined here, not in the server layout: icon components can't cross the server/client boundary.
const SECTIONS: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
  { href: "/admin/operations", label: "Operations", icon: Activity },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText },
  { href: "/admin/settings", label: "Settings", icon: SlidersHorizontal },
];

export function AdminSidebarNav() {
  return <SidebarNav items={SECTIONS} label="Admin" />;
}

export function AdminTabBar() {
  return <BottomTabBar items={SECTIONS} label="Admin" />;
}
