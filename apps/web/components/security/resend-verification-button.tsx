"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sendVerificationAction } from "@/app/app/settings/security/actions";

/** After a send, so a second click doesn't spend the hourly cap on a link that's still on its way. */
const COOLDOWN_MS = 30_000;

export function ResendVerificationButton({
  email,
  variant = "outline",
}: {
  email: string;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [coolingDown, setCoolingDown] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  async function send() {
    setPending(true);
    const result = await sendVerificationAction();
    setPending(false);
    if (!result.ok) return setMessage({ ok: false, text: result.error });
    if (result.alreadyVerified) {
      setMessage({ ok: true, text: `${email} is already confirmed.` });
      router.refresh();
      return;
    }
    setSent(true);
    setCoolingDown(true);
    setMessage({ ok: true, text: `We sent a new link to ${email}. It works for 1 hour.` });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button disabled={pending || coolingDown} onClick={send} size="sm" variant={variant}>
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : null}
        {sent ? "Send again" : "Resend link"}
      </Button>
      {/* min-h: the line is reserved so the message appearing doesn't move the layout. */}
      <p
        className={
          message?.ok === false
            ? "min-h-4 text-xs break-words text-destructive"
            : "min-h-4 text-xs break-words text-success"
        }
        role="status"
      >
        {message?.text}
      </p>
    </div>
  );
}
