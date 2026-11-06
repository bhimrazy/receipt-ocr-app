"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { useState } from "react";
import { ROLE_ITEMS, ROLES, type Role } from "./roles";

export function inviteUrl(id: string) {
  return `${window.location.origin}/accept-invitation/${id}`;
}

/** Copies a link and remembers which one for two seconds, for a "Copied" label. */
export function useCopyLink() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  async function copy(key: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
    } catch {
      setCopiedKey(null);
    }
  }
  return { copiedKey, copy };
}

export function RoleSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  id,
}: {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
}) {
  return (
    <Select
      disabled={disabled}
      items={ROLE_ITEMS}
      onValueChange={(next) => next && onChange(next as Role)}
      value={value}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-32" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        {ROLES.map((role) => (
          <SelectItem key={role.value} value={role.value}>
            <span className="flex flex-col gap-0.5 whitespace-normal">
              <span className="font-medium">{role.label}</span>
              <span className="text-xs text-muted-foreground">{role.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
