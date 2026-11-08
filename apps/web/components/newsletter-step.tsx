import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import Link from "next/link";
import { SlimHeader } from "@/components/legal-page";
import { SiteFooter } from "@/components/site-footer";
import { AuthMessage } from "@/components/auth/auth-field";

const COPY = {
  confirm: {
    title: "Confirm your product updates",
    body: "Press the button to join the list. We send a few emails a year, only about the product.",
    button: "Confirm subscription",
    done: "You're subscribed",
    doneBody:
      "Thanks. You'll get occasional product updates, and every email has an unsubscribe link.",
  },
  unsubscribe: {
    title: "Unsubscribe from product updates",
    body: "Press the button and we'll stop sending product updates to this address.",
    button: "Unsubscribe",
    done: "You're unsubscribed",
    doneBody: "We won't send you product updates. Your account, if you have one, is not affected.",
  },
} as const;

const PROBLEMS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This link doesn't work",
    body: "It may be incomplete or have been changed. Use the link from the email again, or sign up again from the home page.",
  },
  expired: {
    title: "This link has expired",
    body: "Confirmation links last 48 hours. Sign up again from the home page and we'll send a new one.",
  },
  unavailable: {
    title: "We couldn't do that right now",
    body: "Please try again in a few minutes by opening the link in your email again.",
  },
};

/** One step of the emailed flow. Nothing happens on page load; only the button acts. */
export function NewsletterStep({
  step,
  token,
  result,
  action,
}: {
  step: "confirm" | "unsubscribe";
  token: string | undefined;
  result: string | undefined;
  action: (formData: FormData) => Promise<void>;
}) {
  const copy = COPY[step];
  const problem = result ? PROBLEMS[result] : token ? undefined : PROBLEMS.invalid;
  return (
    <>
      <SlimHeader />
      <main className="bg-background px-5 py-14 text-foreground md:py-16">
        <div className="mx-auto max-w-md">
          {result === "done" ? (
            <AuthMessage icon={CircleCheck} title={copy.done} actions={<HomeLink />}>
              <p>{copy.doneBody}</p>
            </AuthMessage>
          ) : problem ? (
            <AuthMessage
              icon={CircleAlert}
              tone="warning"
              title={problem.title}
              actions={<HomeLink />}
            >
              <p>{problem.body}</p>
            </AuthMessage>
          ) : (
            <AuthMessage icon={MailCheck} title={copy.title}>
              <p>{copy.body}</p>
              <form action={action} className="mt-3">
                <input name="t" type="hidden" value={token} />
                <Button className="h-11 w-full" type="submit">
                  {copy.button}
                </Button>
              </form>
            </AuthMessage>
          )}
        </div>
      </main>
      <SiteFooter narrow />
    </>
  );
}

function HomeLink() {
  return (
    <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")} href="/">
      Go to the home page
    </Link>
  );
}
