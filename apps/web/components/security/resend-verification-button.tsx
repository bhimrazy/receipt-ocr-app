"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { sendVerificationAction } from "@/app/app/settings/security/actions";

export function ResendVerificationButton({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setPending(true);
    const result = await sendVerificationAction();
    setPending(false);
    setMessage(
      result.ok
        ? { ok: true, text: `We sent a link to ${email}. It works for 1 hour.` }
        : { ok: false, text: result.error },
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button disabled={pending} onClick={send} size="sm" variant="outline">
        {pending ? (
          <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : null}
        Send link
      </Button>
      <p
        className={message?.ok === false ? "text-xs text-destructive" : "text-xs text-success"}
        role="status"
      >
        {message?.text}
      </p>
    </div>
  );
}
