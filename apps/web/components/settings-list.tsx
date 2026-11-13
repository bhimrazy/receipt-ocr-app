"use client";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@receipt-ocr/ui/components/drawer";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ChevronRight,
  CircleHelp,
  CreditCard,
  Palette,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { ThemeChoiceLabel, ThemeToggle } from "@/components/theme-toggle";
import { openSupportWidget } from "@/lib/support-widget";

export type SettingsLink = {
  href: string;
  label: string;
  value: string;
  /** A second line under the label, for a value too long to sit beside it at 390px. */
  detail?: string;
  icon: "plan" | "workspace" | "groups" | "security";
};

/** A link row, or "appearance" (a sheet) or "help" (the support form, which must be on the page). */
export type SettingsRow = SettingsLink | "appearance" | "help";

const ICONS: Record<SettingsLink["icon"], LucideIcon> = {
  plan: CreditCard,
  workspace: Users,
  groups: Tags,
  security: ShieldCheck,
};

const rowClass =
  "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left outline-none select-none hover:bg-wash-subtle active:bg-wash focus-visible:bg-wash-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function RowBody({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  detail?: string;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
      >
        <Icon className="size-4" />
      </span>
      {detail ? (
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-medium">{label}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">{detail}</span>
        </span>
      ) : (
        <span className="text-base font-medium">{label}</span>
      )}
      <span className="ml-auto min-w-0 truncate pl-2 text-sm text-muted-foreground">{value}</span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}

/**
 * Settings on a phone: a grouped list of rows (label, current value, chevron) that open their
 * sub-page, or a sheet for Appearance, as native settings do. Hidden from md up, where the
 * sections show in full.
 */
export function SettingsList({ rows, className }: { rows: SettingsRow[]; className?: string }) {
  return (
    <nav aria-label="Settings" className={cn("md:hidden", className)}>
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {rows.map((row) =>
          row === "appearance" ? (
            <li key={row}>
              <AppearanceRow />
            </li>
          ) : row === "help" ? (
            <li key={row}>
              <button
                aria-haspopup="dialog"
                className={rowClass}
                data-touch-row=""
                onClick={(event) =>
                  openSupportWidget("getting-started", { returnFocus: event.currentTarget })
                }
                type="button"
              >
                <RowBody icon={CircleHelp} label="Help and feedback" value="" />
              </button>
            </li>
          ) : (
            <li key={row.href}>
              <Link className={rowClass} data-touch-row="" href={row.href}>
                <RowBody
                  detail={row.detail}
                  icon={ICONS[row.icon]}
                  label={row.label}
                  value={row.value}
                />
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

function AppearanceRow() {
  return (
    <Drawer>
      <DrawerTrigger aria-haspopup="dialog" className={rowClass} data-touch-row="">
        <RowBody icon={Palette} label="Appearance" value={<ThemeChoiceLabel />} />
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle id="appearance-sheet-title">Appearance</DrawerTitle>
          <DrawerDescription>
            Match your device, or choose one. Saved on this device.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-5 pb-2">
          <ThemeToggle aria-labelledby="appearance-sheet-title" className="w-full" labels />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
