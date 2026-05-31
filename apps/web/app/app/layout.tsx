import { UserButton } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
import { Button } from "@receipt-ocr/ui/components/button";
import { History, Settings, Upload } from "lucide-react";
import Link from "next/link";

const nav = [
  { href: "/app/upload", label: "Upload", icon: Upload },
  { href: "/app/history", label: "History", icon: History },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const userControl = clerkEnabled ? (
    <UserButton afterSignOutUrl="/" />
  ) : (
    <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">
      auth preview
    </span>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-[#0f0f11] p-5 md:flex md:flex-col">
        <div className="mb-10">
          <Brand />
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button asChild className="justify-start" key={item.href} variant="ghost">
                <Link href={item.href}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Free tier</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="font-mono text-2xl font-semibold">23</span>
            <span className="text-xs text-muted-foreground">/50 this month</span>
          </div>
          <div className="mt-3 h-1 rounded-full bg-border">
            <div className="h-full w-[46%] rounded-full bg-primary" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border px-5 md:hidden">
          <Brand />
          {userControl}
        </header>
        <header className="hidden h-16 items-center justify-end border-b border-border px-8 md:flex">
          {userControl}
        </header>
        <main className="flex-1 overflow-auto p-5 md:p-10">{children}</main>
      </div>
    </div>
  );
}
