"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import {
  Drawer,
  DrawerAction,
  DrawerContent,
  DrawerDescription,
  DrawerGroup,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@receipt-ocr/ui/components/drawer";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronsUpDown, Cookie, LogOut, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOutAndClearHint } from "@/lib/auth-client";
import { CreateWorkspaceDialog, WorkspaceList } from "@/components/workspace-switcher";
import { openConsentSettingsFrom } from "@/lib/consent/store";
import type { WorkspaceOption } from "@/lib/workspaces";

export type MenuUser = { name: string | null; email: string; image: string | null };

function Avatar({ user, className }: { user: MenuUser; className?: string }) {
  const initial = (user.name?.trim() || user.email || "?").charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary",
        className,
      )}
    >
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="size-full object-cover" src={user.image} />
      ) : (
        initial
      )}
    </span>
  );
}

function useSignOut() {
  const router = useRouter();
  return async () => {
    await signOutAndClearHint();
    router.push("/");
    router.refresh();
  };
}

/**
 * Desktop account menu at the foot of the sidebar. The server layout passes the user, so
 * there's no loading flash.
 */
export function UserMenu({ user, showAdmin }: { user: MenuUser; showAdmin: boolean }) {
  const handleSignOut = useSignOut();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={triggerRef}
        aria-label="Account menu"
        className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-wash"
      >
        <Avatar className="size-8" user={user} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.name || "Your account"}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-2rem)]" side="top">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.name || "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/app/settings" />}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        {showAdmin ? (
          <DropdownMenuItem render={<Link href="/admin" />}>
            <ShieldCheck aria-hidden="true" />
            Admin
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => openConsentSettingsFrom(triggerRef.current)}>
          <Cookie aria-hidden="true" />
          Cookie settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const OPEN_ACCOUNT_SHEET = "account-sheet:open";

/** The workspace name in the phone app bar; opens the account sheet, which lists the workspaces. */
export function WorkspaceNameButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      aria-haspopup="dialog"
      className="max-w-full truncate rounded-md px-1 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => window.dispatchEvent(new Event(OPEN_ACCOUNT_SHEET))}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The phone account sheet behind the avatar in the top bar: who's signed in, the workspace
 * (switch or create), today's usage, Admin for platform admins, and sign out. A sheet rather
 * than a dropdown so every row is a full-width thumb target.
 */
export function AccountSheet({
  user,
  showAdmin,
  workspace,
  usage,
  settingsLink = false,
}: {
  user: MenuUser;
  showAdmin: boolean;
  /** Settings has no tab in the three-tab bar, so the sheet carries it. */
  settingsLink?: boolean;
  /** Omitted in the admin shell, which has no active workspace of its own. */
  workspace?: {
    activeId: string;
    canCreate: boolean;
    planNote: string;
    workspaces: WorkspaceOption[];
  };
  /** The usage meter, rendered by the server layout. */
  usage?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const handleSignOut = useSignOut();
  const close = () => setOpen(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const openSheet = () => setOpen(true);
    window.addEventListener(OPEN_ACCOUNT_SHEET, openSheet);
    return () => window.removeEventListener(OPEN_ACCOUNT_SHEET, openSheet);
  }, []);

  return (
    <>
      <Drawer onOpenChange={setOpen} open={open}>
        <DrawerTrigger
          ref={triggerRef}
          aria-label="Account and workspace"
          className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:opacity-80"
        >
          <Avatar className="size-9 border border-border" user={user} />
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="flex-row items-center gap-3">
            <Avatar className="size-10" user={user} />
            <div className="min-w-0">
              <DrawerTitle className="truncate">{user.name || "Your account"}</DrawerTitle>
              <DrawerDescription className="truncate">{user.email}</DrawerDescription>
            </div>
          </DrawerHeader>
          {workspace ? (
            <WorkspaceList
              {...workspace}
              onCreate={() => {
                close();
                setCreateOpen(true);
              }}
              onSwitched={close}
            />
          ) : null}
          {usage ? <div className="border-t border-border px-4 py-3">{usage}</div> : null}
          <DrawerGroup>
            {settingsLink ? (
              <DrawerAction onClick={close} render={<Link href="/app/settings" />}>
                <Settings aria-hidden="true" />
                Settings
              </DrawerAction>
            ) : null}
            {showAdmin ? (
              <DrawerAction onClick={close} render={<Link href="/admin" />}>
                <ShieldCheck aria-hidden="true" />
                Admin
              </DrawerAction>
            ) : null}
            <DrawerAction
              onClick={() => {
                close();
                openConsentSettingsFrom(triggerRef.current);
              }}
            >
              <Cookie aria-hidden="true" />
              Cookie settings
            </DrawerAction>
            <DrawerAction onClick={handleSignOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </DrawerAction>
          </DrawerGroup>
        </DrawerContent>
      </Drawer>
      {workspace ? <CreateWorkspaceDialog onOpenChange={setCreateOpen} open={createOpen} /> : null}
    </>
  );
}
