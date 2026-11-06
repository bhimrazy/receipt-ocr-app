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
import { Input } from "@receipt-ocr/ui/components/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
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

/**
 * Workspaces and the active one come from the server layout, so there is no client fetch or
 * loading flash; only switching and creating call the auth client. `canCreate` comes from the server (lib/workspaces.ts) and counts only the
 * workspaces the user OWNS, so memberships elsewhere don't lock creation.
 */
export function WorkspaceSwitcher({
  activeId,
  canCreate,
  workspaces,
}: {
  activeId: string;
  canCreate: boolean;
  workspaces: WorkspaceOption[];
}) {
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const orgs = workspaces;
  const current = orgs.find((org) => org.id === activeId) ?? orgs[0];

  async function handleSwitch(organizationId: string) {
    if (organizationId === current?.id) {
      setMenuOpen(false);
      return;
    }
    setSwitchError(null);
    setSwitchingTo(organizationId);
    const { error } = await authClient.organization.setActive({ organizationId });
    setSwitchingTo(null);
    if (error) {
      setSwitchError(error.message ?? "Couldn't switch workspace. Try again.");
      return;
    }
    setMenuOpen(false);
    router.refresh();
  }

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
    setCreateOpen(false);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setSwitchError(null);
        }}
        open={menuOpen}
      >
        <DropdownMenuTrigger
          aria-label={`Workspace: ${current?.name ?? "none"}. Switch workspace`}
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-left text-sm transition outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring max-md:h-11"
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
            {orgs.map((org) => {
              const isActive = org.id === current?.id;
              return (
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={switchingTo !== null}
                  key={org.id}
                  onClick={() => void handleSwitch(org.id)}
                >
                  <Initial name={org.name} />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {switchingTo === org.id ? (
                    <Loader2
                      aria-label="Switching"
                      className="animate-spin text-muted-foreground"
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
            <DropdownMenuItem
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              <Plus aria-hidden="true" />
              Create workspace
            </DropdownMenuItem>
          ) : (
            <p className="px-2.5 py-2 text-xs leading-5 text-muted-foreground">
              Your plan includes 1 workspace. Contact us for more.
            </p>
          )}
          {switchError ? (
            <p className="px-2.5 py-1.5 text-xs text-destructive" role="alert">
              {switchError}
            </p>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog onOpenChange={(open) => !creating && setCreateOpen(open)} open={createOpen}>
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
                onClick={() => setCreateOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={creating} type="submit">
                {creating ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
                Create workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
