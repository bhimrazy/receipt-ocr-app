import { Brand } from "@/components/brand";
import { UserMenu } from "@/components/user-menu";
import { authEnabled } from "@/lib/env";
import { getSession, isAdmin } from "@/lib/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Button } from "@receipt-ocr/ui/components/button";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Graceful degradation: when auth isn't configured, show a friendly card
  // instead of redirecting or crashing.
  if (!authEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-primary" />
              Auth not configured
            </CardTitle>
            <CardDescription>
              The admin panel needs Better Auth. Set <code className="font-mono">DATABASE_URL</code>{" "}
              and <code className="font-mono">BETTER_AUTH_SECRET</code>, then bootstrap an admin
              with <code className="font-mono">ADMIN_EMAILS</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/">
                <ArrowLeft className="size-4" />
                Back home
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!isAdmin(session)) notFound();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-[#0f0f11] p-5 md:flex md:flex-col">
        <Link className="mb-8" href="/app">
          <Brand />
        </Link>
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
          <ShieldCheck className="size-4" />
          Admin
        </div>
        <AdminNav />
        <div className="mt-auto">
          <Button asChild className="w-full justify-start" variant="ghost">
            <Link href="/app">
              <ArrowLeft className="size-4" />
              Back to app
            </Link>
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border px-5 md:px-8">
          <span className="text-sm font-medium md:hidden">Admin</span>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-5 md:p-10">{children}</main>
      </div>
    </div>
  );
}
