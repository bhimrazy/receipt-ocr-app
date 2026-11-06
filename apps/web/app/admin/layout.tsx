import { Brand } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { requireAdmin } from "@/lib/session";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminBackLink, AdminSidebarNav, AdminTabBar } from "./admin-nav";

// Signed-in pages are private; keep them out of search results even if a link leaks.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  return (
    <Toaster>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-[#0f0f11] p-5 md:flex md:flex-col">
          <Link
            className="mb-8 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/app"
          >
            <Brand />
          </Link>
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Admin
          </div>
          <AdminSidebarNav />
          <div className="mt-auto">
            <AdminBackLink />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-5 md:px-8">
            <span className="flex items-center gap-2 text-sm font-medium text-primary md:hidden">
              <ShieldCheck aria-hidden="true" className="size-4" />
              Admin
            </span>
            <div className="ml-auto">
              <UserMenu
                showAdmin
                user={{
                  name: session.user.name ?? null,
                  email: session.user.email,
                  image: session.user.image ?? null,
                }}
              />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-5 pb-20 md:p-10">{children}</main>
        </div>
        <AdminTabBar />
      </div>
    </Toaster>
  );
}
