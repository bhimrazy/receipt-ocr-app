"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/** Shown to a signed-in user whose workspace could not be found or created. */
export function NoWorkspace({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re not in a workspace</CardTitle>
          <CardDescription>
            {email} is signed in, but isn&apos;t a member of any workspace, and we couldn&apos;t set
            one up. Try again in a moment, ask a workspace owner for an invite, or sign out and use
            a different account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => router.refresh()}>Try again</Button>
          <Button onClick={handleSignOut} variant="outline">
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
