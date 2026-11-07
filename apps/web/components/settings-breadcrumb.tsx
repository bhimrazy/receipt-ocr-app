import { ChevronRight } from "lucide-react";
import Link from "next/link";

/** "Settings › <page>" above a settings sub-page title. */
export function SettingsBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex items-center gap-1 text-xs text-muted-foreground">
        <li>
          <Link
            className="inline-flex items-center rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
            href="/app/settings"
          >
            Settings
          </Link>
        </li>
        <li aria-hidden="true">
          <ChevronRight className="size-3.5" />
        </li>
        <li aria-current="page" className="text-foreground">
          {current}
        </li>
      </ol>
    </nav>
  );
}
