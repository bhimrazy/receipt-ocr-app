import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { Check, Cloud, Database, Key, Plus, Shield, Users } from "lucide-react";
import Link from "next/link";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage OCR provider, storage, and backend integration details.
        </p>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              Workspace &amp; members
            </CardTitle>
            <CardDescription>Invite teammates, assign roles, and manage pending invitations.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/app/settings/members">
                <Users className="size-4" />
                Manage members
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="size-5 text-primary" />
              AI Provider
            </CardTitle>
            <CardDescription>Gemini is wired through the AI SDK for easier provider switching later.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-4">
              <div>
                <div className="font-medium">Google Gemini</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">GOOGLE_GENERATIVE_AI_API_KEY</div>
              </div>
              <Badge>
                <Check className="mr-1 size-3" />
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="size-5 text-primary" />
              S3-Compatible Storage
            </CardTitle>
            <CardDescription>R2-first configuration that can point to S3 or MinIO with env changes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_FORCE_PATH_STYLE"].map((env) => (
              <div className="rounded-lg border border-border bg-background/40 p-3" key={env}>
                <div className="font-mono text-xs text-muted-foreground">{env}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-5 text-primary" />
              Postgres + Drizzle
            </CardTitle>
            <CardDescription>Receipt records and items are stored in Postgres with statuses ready for BullMQ.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline">
              <Plus className="size-4" />
              Generate API key later
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="size-5 text-primary" />
              Auth
            </CardTitle>
            <CardDescription>Better Auth protects app routes and upload APIs. Enable Google/GitHub by setting their OAuth env vars.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
