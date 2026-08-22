"use client";

import { Check, ChevronsUpDown, Loader2, Lock, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

function initialFor(name: string) {
  return (name.trim() || "?").charAt(0).toUpperCase();
}

/**
 * `canCreate` is computed on the server (see lib/workspaces.ts) from the number
 * of workspaces the user OWNS. Counting client-side from the org list was
 * wrong: it included workspaces the user had merely been invited to, so being
 * a member somewhere else falsely locked "Create workspace".
 */
export function WorkspaceSwitcher({ canCreate }: { canCreate: boolean }) {
  const { data: organizations, isPending: orgsPending } = authClient.useListOrganizations();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data: session } = authClient.useSession();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (orgsPending) {
    return <span className="h-9 w-40 animate-pulse rounded-lg border border-border bg-card" />;
  }

  const orgs = organizations ?? [];
  const limitReached = !canCreate;
  const current = activeOrg ?? orgs.find((org) => org.id === session?.session.activeOrganizationId) ?? orgs[0];

  async function handleSwitch(organizationId: string) {
    if (organizationId === current?.id) {
      setOpen(false);
      return;
    }
    setError(null);
    setSwitchingTo(organizationId);
    const { error: switchError } = await authClient.organization.setActive({ organizationId });
    setSwitchingTo(null);
    if (switchError) {
      setError(switchError.message ?? "Could not switch workspace.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    const trimmed = name.trim();
    const slug = `${trimmed.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const { data, error: createError } = await authClient.organization.create({ name: trimmed, slug });
    setCreating(false);
    if (createError || !data) {
      // Server-side organizationLimit rejects when the plan cap is hit; surface it.
      setError(createError?.message ?? "Could not create workspace.");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    setName("");
    setShowCreate(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-left text-sm transition hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-semibold text-primary">
          {initialFor(current?.name ?? "?")}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{current?.name ?? "No workspace"}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open ? (
        <div
          className="absolute left-0 top-11 z-50 w-64 rounded-xl border border-border bg-card p-1.5 shadow-2xl"
          role="menu"
        >
          <p className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Workspaces
          </p>
          <ul className="flex flex-col">
            {orgs.map((org) => {
              const isActive = org.id === current?.id;
              return (
                <li key={org.id}>
                  <button
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-foreground/[0.06]"
                    disabled={switchingTo !== null}
                    onClick={() => handleSwitch(org.id)}
                    role="menuitem"
                    type="button"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-semibold text-primary">
                      {initialFor(org.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{org.name}</span>
                    {switchingTo === org.id ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : isActive ? (
                      <Check className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-1 h-px bg-border" />

          {showCreate ? (
            <form className="flex flex-col gap-2 p-1.5" onSubmit={handleCreate}>
              <input
                aria-label="Workspace name"
                autoFocus
                className="h-9 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary"
                onChange={(event) => setName(event.target.value)}
                placeholder="Workspace name"
                required
                value={name}
              />
              <div className="flex gap-2">
                <button
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground transition disabled:opacity-50"
                  disabled={creating || !name.trim()}
                  type="submit"
                >
                  {creating ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Create
                </button>
                <button
                  className="h-8 rounded-full px-3 text-xs text-muted-foreground transition hover:text-foreground"
                  onClick={() => {
                    setShowCreate(false);
                    setError(null);
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition enabled:hover:bg-foreground/[0.06] enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              disabled={limitReached}
              onClick={() => setShowCreate(true)}
              role="menuitem"
              title={limitReached ? "Upgrade to create more workspaces" : "Create a new workspace"}
              type="button"
            >
              {limitReached ? <Lock className="size-4" /> : <Plus className="size-4" />}
              {limitReached ? "Upgrade to add workspaces" : "Create workspace"}
            </button>
          )}

          {error ? (
            <p className="px-3 py-1.5 text-xs text-red-400" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
