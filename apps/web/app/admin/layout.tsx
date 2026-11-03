import { Brand } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { authEnabled } from "@/lib/env";
import { getSession, isAdmin } from "@/lib/session";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminBackLink, AdminSidebarNav, AdminTabBar } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Without auth there is no admin to check, so explain rather than crash.
  if (!authEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-5 text-foreground">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert aria-hidden="true" className="size-5 text-primary" />
              Admin isn&apos;t available
            </CardTitle>
            <CardDescription>
              Sign-in isn&apos;t set up on this server, so there are no admins yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link className={buttonVariants({ variant: "outline" })} href="/">
              <ArrowLeft aria-hidden="true" />
              Back home
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) notFound();

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
              <UserMenu />
            </div>
          </header>
          <main className="flex-1 overflow-auto p-5 pb-20 md:p-10">{children}</main>
        </div>
        <AdminTabBar />
      </div>
    </Toaster>
  );
}
