"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Building2, CreditCard, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/organizations", label: "Organizations", icon: Building2 },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {sections.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Button
            asChild
            className="justify-start"
            key={item.href}
            variant={active ? "secondary" : "ghost"}
          >
            <Link href={item.href}>
              <Icon className="size-4" />
              {item.label}
            </Link>
          </Button>
        );
      })}
      <div
        aria-disabled
        className="mt-1 flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted-foreground/50"
        title="Coming soon"
      >
        <CreditCard className="size-4" />
        Plans &amp; Billing
        <span className="ml-auto rounded-full border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
          Soon
        </span>
      </div>
    </nav>
  );
}
