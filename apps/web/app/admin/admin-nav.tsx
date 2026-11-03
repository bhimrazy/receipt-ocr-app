"use client";

import { ArrowLeft, Building2, CreditCard, Users } from "lucide-react";
import { BottomTabBar, SidebarNav, type NavItem } from "@/components/app-nav";

// Defined here, not in the server layout: icon components can't cross the server/client boundary.
const SECTIONS: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/organizations", label: "Workspaces", icon: Building2 },
];
const BACK: NavItem = { href: "/app", label: "Back to app", icon: ArrowLeft, exact: true };

export function AdminSidebarNav() {
  return (
    <div className="flex flex-col gap-1">
      <SidebarNav items={SECTIONS} label="Admin" />
      <div
        aria-disabled="true"
        className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground"
      >
        <CreditCard aria-hidden="true" className="size-4" />
        Billing
        <span className="ml-auto rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
          Soon
        </span>
      </div>
    </div>
  );
}

export function AdminBackLink() {
  return <SidebarNav items={[BACK]} label="App" />;
}

export function AdminTabBar() {
  return <BottomTabBar items={[...SECTIONS, BACK]} label="Admin" />;
}
