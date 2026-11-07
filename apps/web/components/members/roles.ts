export type Role = "owner" | "admin" | "member";

/** What the members page needs about each member and invite; the page maps Better Auth's shapes. */
export type WorkspaceMember = {
  id: string;
  userId: string;
  role: Role;
  name: string;
  email: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
};

export const ROLES: { value: Role; label: string; description: string }[] = [
  {
    value: "member",
    label: "Member",
    description: "Uploads receipts and sees everything in the workspace.",
  },
  // Stored as Better Auth's "admin"; shown as Manager so it isn't mistaken for a site admin.
  {
    value: "admin",
    label: "Manager",
    description: "Everything a member can do, plus invites and removes people.",
  },
  {
    value: "owner",
    label: "Owner",
    description: "Full control of the workspace and everyone in it.",
  },
];
export const ROLE_ITEMS = ROLES.map(({ value, label }) => ({ value, label }));
export const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

/** Better Auth stores roles as text; anything unknown is treated as the least-privileged role. */
export function toRole(role: string | null | undefined): Role {
  return role === "owner" || role === "admin" ? role : "member";
}

export function roleLabel(role: Role) {
  return ROLES.find((r) => r.value === role)?.label ?? "Member";
}
