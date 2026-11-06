"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authErrorMessage } from "@/lib/auth-errors";
import { authClient } from "@/lib/auth-client";
import { DEFAULT_REDIRECT } from "@/lib/redirect";
import {
  AuthDivider,
  AuthError,
  AuthField,
  AuthHeading,
  AuthNotice,
  EmailField,
  authCardClass,
  authLinkClass,
} from "./auth-field";
import { CheckEmail } from "./check-email";
import { PasswordField } from "./password-field";

export type SocialProvider = "google" | "github";

const providerNames: Record<SocialProvider, string> = { google: "Google", github: "GitHub" };

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

type FormError = { message: string; signInInstead?: boolean };

export function CredentialsForm({
  mode,
  providers,
  redirectTo = DEFAULT_REDIRECT,
  notice,
  initialError,
  freeReceiptsPerDay,
}: {
  mode: "sign-in" | "sign-up";
  /** The free plan's saved daily limit, shown on sign-up. */
  freeReceiptsPerDay?: number;
  providers: SocialProvider[];
  /** Where to land after auth succeeds, e.g. back to an invite accept page. */
  redirectTo?: string;
  /** Shown above the form: a confirmation (password reset) or context (invitation). */
  notice?: { message: string; kind: "success" | "info" };
  /** Error carried in the URL from an OAuth or email-confirmation redirect. */
  initialError?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [callbackError, setCallbackError] = useState(initialError);
  const [pending, setPending] = useState<"credentials" | SocialProvider | null>(null);
  const [checkEmail, setCheckEmail] = useState<"sign-up" | "sign-in" | null>(null);

  const isSignUp = mode === "sign-up";
  const redirectQuery =
    redirectTo === DEFAULT_REDIRECT ? "" : `?redirect=${encodeURIComponent(redirectTo)}`;
  // Confirmation links and OAuth failures return through /sign-in: it forwards a signed-in user
  // to `redirectTo` and shows any `?error=` code Better Auth appends.
  const callbackURL = `/sign-in${redirectQuery}`;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setCallbackError(undefined);
    setPending("credentials");
    const trimmedEmail = email.trim();
    if (isSignUp) {
      const { data, error: authError } = await authClient.signUp.email({
        name: name.trim(),
        email: trimmedEmail,
        password,
        callbackURL,
      });
      if (authError) {
        setError({
          message: authErrorMessage(authError),
          signInInstead: authError.code?.startsWith("USER_ALREADY_EXISTS"),
        });
        setPending(null);
        return;
      }
      // No session token: the address has to be confirmed first (production).
      if (!data?.token) {
        setPending(null);
        setCheckEmail("sign-up");
        return;
      }
    } else {
      const { data, error: authError } = await authClient.signIn.email({
        email: trimmedEmail,
        password,
        // Also the target of the confirmation link Better Auth emails to unconfirmed accounts.
        callbackURL,
      });
      if (authError) {
        setPending(null);
        // Better Auth has already emailed a fresh confirmation link (sendOnSignIn).
        if (authError.code === "EMAIL_NOT_VERIFIED") {
          setCheckEmail("sign-in");
          return;
        }
        setError({ message: authErrorMessage(authError) });
        return;
      }
      // With a callbackURL, Better Auth's client navigates there itself (a full page load).
      if (data?.redirect) return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function handleSocial(provider: SocialProvider) {
    setError(null);
    setCallbackError(undefined);
    setPending(provider);
    const { error: authError } = await authClient.signIn.social({
      provider,
      callbackURL: redirectTo,
      errorCallbackURL: callbackURL,
    });
    if (authError) {
      setError({ message: authErrorMessage(authError) });
      setPending(null);
    }
  }

  if (checkEmail) {
    return (
      <CheckEmail
        callbackURL={callbackURL}
        email={email.trim()}
        onBack={() => {
          setCheckEmail(null);
          setPassword("");
        }}
        reason={checkEmail}
      />
    );
  }

  const busy = pending !== null;
  const switchHref = isSignUp ? `/sign-in${redirectQuery}` : `/sign-up${redirectQuery}`;

  return (
    <div className={authCardClass}>
      <AuthHeading title={isSignUp ? "Create your account" : "Sign in to receiptOCR"}>
        {isSignUp && freeReceiptsPerDay !== undefined
          ? `Free plan: ${freeReceiptsPerDay} receipts a day. No card required.`
          : undefined}
      </AuthHeading>
      {notice ? (
        <AuthNotice className="mt-5" kind={notice.kind}>
          {notice.message}
        </AuthNotice>
      ) : null}
      {callbackError ? <AuthError className="mt-5">{callbackError}</AuthError> : null}

      {providers.length > 0 ? (
        <>
          <div className="mt-6 flex flex-col gap-2.5">
            {providers.map((provider) => {
              const Icon = providerIcons[provider];
              return (
                <Button
                  className="h-11 w-full"
                  disabled={busy}
                  key={provider}
                  onClick={() => handleSocial(provider)}
                  type="button"
                  variant="outline"
                >
                  {pending === provider ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : (
                    <Icon />
                  )}
                  Continue with {providerNames[provider]}
                </Button>
              );
            })}
          </div>
          <AuthDivider>or with email</AuthDivider>
        </>
      ) : (
        <div className="mt-6" />
      )}

      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {isSignUp ? (
          <AuthField
            autoComplete="name"
            id="auth-name"
            label="Name"
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        ) : null}
        <EmailField
          id="auth-email"
          label="Email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          required
          value={email}
        />
        <PasswordField
          autoComplete={isSignUp ? "new-password" : "current-password"}
          id="auth-password"
          label="Password"
          maxLength={128}
          minLength={isSignUp ? 8 : undefined}
          onChange={(event) => setPassword(event.target.value)}
          required
          value={password}
        />
        {error ? (
          <AuthError>
            {error.signInInstead ? (
              <>
                An account with this email already exists.{" "}
                <Link className={cn(authLinkClass, "text-destructive underline")} href={switchHref}>
                  Sign in instead
                </Link>
              </>
            ) : (
              error.message
            )}
          </AuthError>
        ) : null}
        <Button className="mt-1 h-11 w-full" disabled={busy} type="submit">
          {pending === "credentials" ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {isSignUp ? "Creating account…" : "Signing in…"}
            </>
          ) : isSignUp ? (
            "Create account"
          ) : (
            "Sign in"
          )}
        </Button>
        {isSignUp ? null : (
          <Link
            className={cn(
              authLinkClass,
              "-mt-2 inline-flex min-h-11 items-center justify-center self-center font-normal text-muted-foreground hover:text-foreground",
            )}
            href="/forgot-password"
          >
            Forgot your password?
          </Link>
        )}
        {isSignUp ? (
          <p className="text-center text-xs leading-5 text-muted-foreground">
            By creating an account you agree to the{" "}
            <Link className={cn(authLinkClass, "font-normal text-foreground")} href="/terms">
              Terms
            </Link>{" "}
            and the{" "}
            <Link className={cn(authLinkClass, "font-normal text-foreground")} href="/privacy">
              Privacy Policy
            </Link>
            .
          </p>
        ) : null}
      </form>

      <p className="mt-6 border-t border-border pt-5 text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account?" : "New to receiptOCR?"}{" "}
        <Link
          className={cn(authLinkClass, "inline-flex min-h-11 min-w-11 items-center justify-center")}
          href={switchHref}
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
