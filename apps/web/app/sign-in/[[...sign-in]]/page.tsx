import { SignIn } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
import Link from "next/link";

export default function SignInPage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5">
      <div className="absolute left-1/2 top-[35%] size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[170px]" />
      <div className="grid-mask absolute inset-0 opacity-30">
        <div className="receipt-grid absolute -inset-1" />
      </div>
      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <div className="mb-8">
          <Brand />
        </div>
        {clerkEnabled ? (
          <SignIn
            appearance={{
              elements: {
                rootBox: "w-full",
                card: "w-full rounded-2xl border border-white/10 bg-card/80 shadow-2xl backdrop-blur-xl",
                headerTitle: "text-foreground",
                headerSubtitle: "text-muted-foreground",
                socialButtonsBlockButton:
                  "border-border bg-background/40 text-foreground hover:bg-muted",
                formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90",
                footerActionLink: "text-primary",
              },
            }}
            fallbackRedirectUrl="/app/upload"
            signUpFallbackRedirectUrl="/app/upload"
          />
        ) : (
          <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
            <h1 className="text-2xl font-semibold tracking-tight">Clerk is not configured</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to
              `apps/web/.env.local` to enable Google/GitHub sign-in.
            </p>
            <Link
              className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              href="/app/upload"
            >
              Preview app UI
            </Link>
          </div>
        )}
        <div className="mt-6 flex gap-5 text-xs text-muted-foreground">
          <Link className="hover:text-foreground" href="/">
            Back to home
          </Link>
          <a className="hover:text-foreground" href="#">
            Privacy
          </a>
          <a className="hover:text-foreground" href="#">
            Terms
          </a>
        </div>
      </div>
    </main>
  );
}
