import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthMessage } from "@/components/auth/auth-field";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Account deleted",
  description: "Your ReceiptOCR account is deleted.",
  path: "/account-deleted",
  index: false,
});

export const revalidate = 3600;

/** Where the deletion confirm page sends the browser once the account and its session are gone. */
export default function AccountDeletedPage() {
  return (
    <AuthLayout subtitle="Thanks for trying ReceiptOCR.">
      <AuthMessage
        actions={
          <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")} href="/">
            Go to the home page
          </Link>
        }
        icon={CircleCheck}
        title="Your account is deleted"
      >
        <p>
          Your account, the workspaces only you belonged to and their receipts are gone, and
          you&apos;re signed out on this device.
        </p>
      </AuthMessage>
    </AuthLayout>
  );
}
