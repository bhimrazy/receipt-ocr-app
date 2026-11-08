import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { CircleCheck, CircleDashed } from "lucide-react";
import Link from "next/link";
import { ResendVerificationButton } from "@/components/security/resend-verification-button";

type Variant = "default" | "outline";

type Item = {
  id: string;
  done: boolean;
  title: string;
  /** What to do when it isn't done yet. */
  todo: string;
  action: (variant: Variant) => React.ReactNode;
};

function Action({
  href,
  variant,
  children,
}: {
  href: string;
  variant: Variant;
  children: React.ReactNode;
}) {
  return (
    <Link className={buttonVariants({ size: "sm", variant })} href={href}>
      {children}
    </Link>
  );
}

/**
 * The top of Settings → Security: three checks, each unmet one with the control that fixes it.
 * The first unmet one gets the primary button, so there is one obvious next step.
 */
export function SecurityChecklist({
  email,
  emailVerified,
  strongFactor,
  methods,
  hasProviders,
  readOnly,
}: {
  email: string;
  emailVerified: boolean;
  /** A passkey or an authenticator app. */
  strongFactor: boolean;
  /** Ways to sign in (password, Google, GitHub, passkeys). */
  methods: number;
  /** Google or GitHub is set up; if not, a passkey is the only other way in to add. */
  hasProviders: boolean;
  readOnly: boolean;
}) {
  const items: Item[] = [
    {
      id: "email",
      done: emailVerified,
      title: "Email address confirmed",
      todo: `Open the link we emailed to ${email}.`,
      action: (variant) => <ResendVerificationButton email={email} variant={variant} />,
    },
    {
      id: "factor",
      done: strongFactor,
      title: "Protected by a passkey or an app code",
      todo: "So a stolen password alone can't get in.",
      action: (variant) => (
        <Action href="#passkeys-heading" variant={variant}>
          Add a passkey
        </Action>
      ),
    },
    {
      id: "methods",
      done: methods > 1,
      title: "Two or more ways to sign in",
      todo: "If you lose one, you can still get in.",
      action: (variant) => (
        <Action
          href={hasProviders ? "#sign-in-methods-heading" : "#passkeys-heading"}
          variant={variant}
        >
          Add another
        </Action>
      ),
    },
  ];
  const done = items.filter((item) => item.done).length;
  const firstTodo = items.find((item) => !item.done)?.id;

  return (
    <section aria-labelledby="account-protection-heading" className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold" id="account-protection-heading">
          Account protection
        </h2>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">
            {done} of {items.length}
          </span>{" "}
          done
        </p>
      </div>
      <Card>
        <CardContent className="pt-5">
          {done === items.length ? (
            <p className="flex items-start gap-2.5 text-sm">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              All three checks done. Your account is well protected.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li className="flex flex-col gap-2 sm:flex-row sm:items-start" key={item.id}>
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    {item.done ? (
                      <CircleCheck
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-success"
                      />
                    ) : (
                      <CircleDashed
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {item.title}
                        <span className="sr-only">{item.done ? ": done" : ": not done"}</span>
                      </p>
                      {item.done ? null : (
                        <p className="text-xs break-words text-muted-foreground">{item.todo}</p>
                      )}
                    </div>
                  </div>
                  {item.done || readOnly ? null : (
                    <div className="pl-6.5 sm:pl-0">
                      {item.action(item.id === firstTodo ? "default" : "outline")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
