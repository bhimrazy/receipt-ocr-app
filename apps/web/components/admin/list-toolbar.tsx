"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

export type ToolbarSelect = {
  /** URL parameter name. */
  name: string;
  label: string;
  /** The first option is the default and is left out of the URL. */
  options: { value: string; label: string }[];
};

/**
 * Search box plus filter selects for an admin list. State lives in the URL,
 * so filtered views can be linked to and survive a reload; changing anything
 * returns to page 1.
 */
export function ListToolbar({
  searchLabel,
  searchPlaceholder,
  selects,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  selects: ToolbarSelect[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();

  function push(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    const search = next.toString();
    startTransition(() => router.replace(search ? `${pathname}?${search}` : pathname));
  }

  const active = selects.some((s) => params.get(s.name)) || Boolean(params.get("q"));

  return (
    <div
      aria-busy={pending}
      className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end"
    >
      <form
        className="flex min-w-0 gap-2 lg:w-80"
        onSubmit={(event) => {
          event.preventDefault();
          push({ q: query.trim() || null });
        }}
        role="search"
      >
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={searchLabel}
            autoComplete="off"
            className="pl-9"
            name="q"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        {selects.map((select) => {
          const value = params.get(select.name) ?? select.options[0]!.value;
          const id = `filter-${select.name}`;
          return (
            <div className="flex min-w-0 flex-col gap-1" key={select.name}>
              <label className="text-xs text-muted-foreground" htmlFor={id}>
                {select.label}
              </label>
              <Select
                items={select.options}
                onValueChange={(next) =>
                  push({
                    [select.name]: next && next !== select.options[0]!.value ? String(next) : null,
                  })
                }
                value={value}
              >
                <SelectTrigger className="w-full sm:w-40" id={id}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {select.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
        {active ? (
          <Button
            className="col-span-2 self-end sm:col-span-1"
            onClick={() => {
              setQuery("");
              startTransition(() => router.replace(pathname));
            }}
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
