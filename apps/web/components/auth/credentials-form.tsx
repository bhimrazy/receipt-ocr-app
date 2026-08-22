"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export type SocialProvider = "google" | "github";

const providerLabels: Record<SocialProvider, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

function GoogleIcon() {
  return (
    <svg aria-hidden className="size-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.16-3.16A10.97 10.97 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg aria-hidden className="size-4" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.15c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.02 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.78 1.05.78 2.12v3.15c0 .3.2.67.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const providerIcons: Record<SocialProvider, () => React.ReactNode> = {
  google: GoogleIcon,
  github: GitHubIcon,
};

export function CredentialsForm({
  mode,
  providers,
  redirectTo = "/app/upload",
}: {
  mode: "sign-in" | "sign-up";
  providers: SocialProvider[];
  /** Where to land after auth succeeds. Used to return to an invite accept page. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"credentials" | SocialProvider | null>(null);

  const isSignUp = mode === "sign-up";
  const redirectQuery =
    redirectTo === "/app/upload" ? "" : `?redirect=${encodeURIComponent(redirectTo)}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending("credentials");
    const { error: authError } = isSignUp
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });
    if (authError) {
      setError(authError.message ?? "Something went wrong. Please try again.");
      setPending(null);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function handleSocial(provider: SocialProvider) {
    setError(null);
    setPending(provider);
    const { error: authError } = await authClient.signIn.social({
      provider,
      callbackURL: redirectTo,
    });
    if (authError) {
      setError(authError.message ?? "Something went wrong. Please try again.");
      setPending(null);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-card/80 p-8 shadow-2xl backdrop-blur-xl">
      <h2 className="text-2xl font-semibold tracking-tight">
        {isSignUp ? "Create your account" : "Welcome back"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {isSignUp
          ? "Start turning receipts into structured data in seconds."
          : "Sign in to upload receipts and see your history."}
      </p>

      {providers.length > 0 ? (
        <>
          <div className="mt-6 flex flex-col gap-2.5">
            {providers.map((provider) => {
              const Icon = providerIcons[provider];
              return (
                <Button
                  className="w-full"
                  disabled={pending !== null}
                  key={provider}
                  onClick={() => handleSocial(provider)}
                  type="button"
                  variant="outline"
                >
                  {pending === provider ? <Loader2 className="size-4 animate-spin" /> : <Icon />}
                  {providerLabels[provider]}
                </Button>
              );
            })}
          </div>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or continue with email
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      ) : (
        <div className="mt-6" />
      )}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        {isSignUp ? (
          <Input
            autoComplete="name"
            aria-label="Name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            required
            value={name}
          />
        ) : null}
        <Input
          autoComplete="email"
          aria-label="Email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        <div>
          <Input
            autoComplete={isSignUp ? "new-password" : "current-password"}
            aria-label="Password"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password (min. 8 characters)"
            required
            type="password"
            value={password}
          />
          {isSignUp ? null : (
            <p className="mt-2 text-right text-xs">
              <Link className="text-muted-foreground hover:text-foreground" href="/forgot-password">
                Forgot your password?
              </Link>
            </p>
          )}
        </div>
        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <Button className="mt-1 w-full" disabled={pending !== null} type="submit">
          {pending === "credentials" ? <Loader2 className="size-4 animate-spin" /> : null}
          {isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link className="text-primary hover:underline" href={`/sign-in${redirectQuery}`}>
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to receiptOCR?{" "}
            <Link className="text-primary hover:underline" href={`/sign-up${redirectQuery}`}>
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
