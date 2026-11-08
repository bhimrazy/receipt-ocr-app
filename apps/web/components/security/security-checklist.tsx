import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { CircleCheck, CircleDashed } from "lucide-react";
import Link from "next/link";
import { ResendVerificationButton } from "@/components/security/resend-verification-button";

type Item = {
  id: string;
  done: boolean;
  title: string;
  /** What to do when it isn't done yet. */
  todo: string;
  action: React.ReactNode;
};

function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={href}>
      {children}
    </Link>
  );
}

/** The top of Settings → Security: three checks, each unmet one with the control that fixes it. */
export function SecurityChecklist({
  email,
  emailVerified,
  strongFactor,
  methods,
  readOnly,
}: {
  email: string;
  emailVerified: boolean;
  /** A passkey or an authenticator app. */
  strongFactor: boolean;
  /** Ways to sign in (password, Google, GitHub, passkeys). */
  methods: number;
  readOnly: boolean;
}) {
  const items: Item[] = [
    {
      id: "email",
      done: emailVerified,
      title: "Email address confirmed",
      todo: `Confirm ${email} from the link we sent you.`,
      action: <ResendVerificationButton email={email} />,
    },
    {
      id: "factor",
      done: strongFactor,
      title: "A passkey or two-step sign-in",
      todo: "A stolen password alone then isn't enough to get in.",
      action: <Action href="#passkeys-heading">Add a passkey</Action>,
    },
    {
      id: "methods",
      done: methods > 1,
      title: "More than one way to sign in",
      todo: "So losing one doesn't lock you out.",
      action: <Action href="#sign-in-methods-heading">Add one</Action>,
    },
  ];
  const done = items.filter((item) => item.done).length;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="text-sm text-muted-foreground">
          <span className="font-mono tabular-nums">
            {done} of {items.length}
          </span>{" "}
          done
        </p>
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li className="flex flex-col gap-2 sm:flex-row sm:items-start" key={item.id}>
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                {item.done ? (
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
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
              {item.done || readOnly ? null : <div className="pl-6.5 sm:pl-0">{item.action}</div>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
