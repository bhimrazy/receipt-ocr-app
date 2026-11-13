"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { DrawerAction, DrawerGroup, DrawerLabel } from "@receipt-ocr/ui/components/drawer";
import { Input } from "@receipt-ocr/ui/components/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@receipt-ocr/ui/components/field";
import { ArrowRight, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { WorkspaceOption } from "@/lib/workspaces";

// Same rule as packages/core workspace-name.ts: 1–80 characters, no angle brackets or control characters.
const WORKSPACE_NAME_MAX = 80;
const WORKSPACE_NAME_RULE = "Up to 80 characters, without < or >.";

function isValidWorkspaceName(name: string) {
  return name.length <= WORKSPACE_NAME_MAX && !/[<>\u0000-\u001f\u007f-\u009f]/.test(name);
}

function initialFor(name: string) {
  return (name.trim() || "?").charAt(0).toUpperCase();
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-semibold text-primary"
    >
      {initialFor(name)}
    </span>
  );
}

/** Switches the active workspace; the server layout re-renders with the new one. */
function useWorkspaceSwitch(activeId: string, onDone?: () => void) {
  const router = useRouter();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(organizationId: string) {
    if (organizationId === activeId) {
      onDone?.();
      return;
    }
    setError(null);
    setSwitchingTo(organizationId);
    const { error } = await authClient.organization.setActive({ organizationId });
    setSwitchingTo(null);
    if (error) {
      setError(error.message ?? "Couldn't switch workspace. Try again.");
      return;
    }
    onDone?.();
    router.refresh();
  }

  return { switchTo, switchingTo, error, clearError: () => setError(null) };
}

/** The create form. Controlled, so a phone sheet can close itself and then open this. */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError("Enter a name for the workspace.");
      return;
    }
    if (!isValidWorkspaceName(trimmed)) {
      setCreateError("Remove < and > from the name.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const slug = `${trimmed
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
    const { data, error } = await authClient.organization.create({ name: trimmed, slug });
    if (error || !data) {
      setCreating(false);
      // The server-side organizationLimit rejects when the plan cap is hit.
      setCreateError(error?.message ?? "Couldn't create the workspace. Try again.");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    setCreating(false);
    setName("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (creating) return;
        if (next) setCreateError(null);
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent>
        <form className="grid gap-4" noValidate onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>
              A separate space with its own receipts and members.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={createError ? true : undefined}>
            <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
            <Input
              aria-describedby={
                createError ? "workspace-name-error workspace-name-hint" : "workspace-name-hint"
              }
              aria-invalid={createError ? true : undefined}
              autoComplete="off"
              id="workspace-name"
              maxLength={WORKSPACE_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Household"
              value={name}
            />
            <FieldDescription id="workspace-name-hint">{WORKSPACE_NAME_RULE}</FieldDescription>
            <FieldError id="workspace-name-error">{createError}</FieldError>
          </Field>
          <DialogFooter>
            <Button
              disabled={creating}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={creating} type="submit">
              {creating ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PLANS_HREF = "/app/settings/billing";

type SwitcherProps = {
  activeId: string;
  canCreate: boolean;
  /** Shown instead of "Create workspace" at the ownership cap (lib/workspaces.ts). */
  planNote: string;
  /** A Free account at its cap: link the plans, so the note has somewhere to go. */
  comparePlans: boolean;
  workspaces: WorkspaceOption[];
};

/**
 * Desktop sidebar dropdown. Workspaces and the active one come from the server layout, so
 * there is no client fetch or loading flash; only switching and creating call the auth client.
 * `canCreate` comes from the server (lib/workspaces.ts) and counts only the workspaces the
 * user OWNS, so memberships elsewhere don't lock creation.
 */
export function WorkspaceSwitcher({
  activeId,
  canCreate,
  planNote,
  comparePlans,
  workspaces,
}: SwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const current = workspaces.find((org) => org.id === activeId) ?? workspaces[0];
  const { switchTo, switchingTo, error, clearError } = useWorkspaceSwitch(
    current?.id ?? activeId,
    () => setMenuOpen(false),
  );

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) clearError();
        }}
        open={menuOpen}
      >
        <DropdownMenuTrigger
          aria-label={`Workspace: ${current?.name ?? "none"}. Switch workspace`}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-left text-sm transition outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Initial name={current?.name ?? "?"} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {current?.name ?? "No workspace"}
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {workspaces.map((org) => {
              const isActive = org.id === current?.id;
              return (
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={switchingTo !== null}
                  key={org.id}
                  onClick={() => void switchTo(org.id)}
                >
                  <Initial name={org.name} />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {switchingTo === org.id ? (
                    <Loader2
                      aria-label="Switching"
                      className="animate-spin motion-reduce:animate-none text-muted-foreground"
                    />
                  ) : isActive ? (
                    <Check aria-label="Current workspace" className="text-primary" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {canCreate ? (
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Create workspace
            </DropdownMenuItem>
          ) : (
            <>
              <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">{planNote}</p>
              {comparePlans ? (
                <DropdownMenuItem render={<Link href={PLANS_HREF} />}>
                  <ArrowRight aria-hidden="true" />
                  Compare plans
                </DropdownMenuItem>
              ) : null}
            </>
          )}
          {error ? (
            <p className="px-2.5 py-1.5 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog onOpenChange={setCreateOpen} open={createOpen} />
    </>
  );
}

/**
 * The same choices as rows in the phone account sheet. `onSwitched` closes the sheet;
 * `onCreate` asks the sheet's owner to close it and open the create dialog.
 */
export function WorkspaceList({
  activeId,
  canCreate,
  planNote,
  comparePlans,
  workspaces,
  onSwitched,
  onCreate,
}: SwitcherProps & { onSwitched: () => void; onCreate: () => void }) {
  const current = workspaces.find((org) => org.id === activeId) ?? workspaces[0];
  const { switchTo, switchingTo, error } = useWorkspaceSwitch(current?.id ?? activeId, onSwitched);

  return (
    <DrawerGroup aria-labelledby="workspace-list-label" role="group">
      <DrawerLabel id="workspace-list-label">Workspace</DrawerLabel>
      {workspaces.map((org) => {
        const isActive = org.id === current?.id;
        return (
          <DrawerAction
            aria-current={isActive ? "true" : undefined}
            disabled={switchingTo !== null}
            key={org.id}
            onClick={() => void switchTo(org.id)}
          >
            <Initial name={org.name} />
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {switchingTo === org.id ? (
              <Loader2
                aria-label="Switching"
                className="animate-spin text-muted-foreground motion-reduce:animate-none"
              />
            ) : isActive ? (
              // aria-current on the row already says it.
              <Check aria-hidden="true" className="text-primary!" />
            ) : null}
          </DrawerAction>
        );
      })}
      {canCreate ? (
        <DrawerAction onClick={onCreate}>
          <Plus aria-hidden="true" />
          Create workspace
        </DrawerAction>
      ) : (
        <>
          <p className="px-3 py-2 text-xs leading-5 text-muted-foreground">{planNote}</p>
          {comparePlans ? (
            <DrawerAction onClick={onSwitched} render={<Link href={PLANS_HREF} />}>
              <ArrowRight aria-hidden="true" />
              Compare plans
            </DrawerAction>
          ) : null}
        </>
      )}
      {error ? (
        <p className="px-3 py-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </DrawerGroup>
  );
}
