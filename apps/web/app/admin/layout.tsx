import { SkipLink } from "@/components/skip-link";
import { Brand } from "@/components/brand";
import { MobileTopBar } from "@/components/app-nav";
import { StepUpProvider } from "@/components/step-up/step-up";
import { AccountSheet, UserMenu, type MenuUser } from "@/components/user-menu";
import { requireAdmin } from "@/lib/session";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminSidebarNav, AdminTabBar } from "./admin-nav";

// Always per request: a build without auth env must never cache an admin page.
export const dynamic = "force-dynamic";

// Private pages; keep them out of search results even if a link leaks.
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · receiptOCR" },
  robots: { index: false, follow: false },
};

function AdminMark() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      <ShieldCheck aria-hidden="true" className="size-3.5" />
      Admin
    </span>
  );
}

/**
 * The admin shell. Same bones as the customer app, but marked "Admin" in the
 * sidebar and header, with a primary rule across the top, and "Back to app"
 * always one tap away, so it's never mistaken for the customer view.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const user: MenuUser = {
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
  };
  const backToApp = (
    <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/app">
      <ArrowLeft aria-hidden="true" />
      Back to app
    </Link>
  );

  return (
    <Toaster>
      <SkipLink />
      <div className="flex min-h-dvh flex-col border-t-2 border-primary bg-background text-foreground">
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-64 shrink-0 border-r border-border bg-card/40 md:block">
            <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
              <div className="flex min-h-11 items-center justify-between gap-2 px-1">
                <Link
                  className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href="/admin"
                >
                  <Brand />
                </Link>
                <AdminMark />
              </div>
              <AdminSidebarNav />
              <div className="mt-auto flex flex-col gap-3">
                {backToApp}
                <UserMenu showAdmin user={user} />
              </div>
            </aside>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar
              context={<AdminMark />}
              home="/admin"
              leading={<Brand compact />}
              trailing={
                <>
                  <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/app">
                    <ArrowLeft aria-hidden="true" />
                    App
                  </Link>
                  <AccountSheet showAdmin={false} user={user} />
                </>
              }
            />
            <main
              id="main-content"
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pt-5 pb-[calc(2rem+var(--app-bottom-inset,0px))] md:px-10 md:py-10"
            >
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </div>
        </div>
        <AdminTabBar />
      </div>
      <StepUpProvider />
    </Toaster>
  );
}
