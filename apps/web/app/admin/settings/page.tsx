import { OCR_MODELS, OCR_PROVIDERS } from "@receipt-ocr/ai/models";
import {
  DEFAULT_PLANS,
  findUser,
  loadDailyOcrCap,
  OCR_DEADLINE_MS,
  providerAvailability,
  Settings,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingsSection } from "@/components/settings-section";
import { formatDateTime } from "@/lib/format";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { OcrChainForm } from "./ocr-chain-form";
import { PlanLimitsForm } from "./plan-limits-form";

export const metadata: Metadata = { title: "Settings" };

async function savedLine(saved?: { updatedAt: Date; updatedBy: string | null }) {
  if (!saved) return "Using the defaults in code. Nothing has been saved here yet.";
  const admin = saved.updatedBy ? await runtime.runPromise(findUser(saved.updatedBy)) : null;
  const who = admin?.email ?? "a deleted admin";
  return `Last saved ${formatDateTime(saved.updatedAt)} by ${who}.`;
}

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [snapshot, available, cap] = await runtime.runPromise(
    Effect.all([
      Effect.flatMap(Settings, (settings) => settings.get),
      providerAvailability,
      loadDailyOcrCap.pipe(Effect.orElseSucceed(() => undefined)),
    ]),
  );
  // The offline fixture is only offered where it can run (tests, local).
  const models = OCR_MODELS.filter((m) => available[m.provider] || m.provider !== "fixture");
  const providers = OCR_PROVIDERS.filter((p) => available[p.id] || p.id !== "fixture");

  return (
    <>
      <AdminPageHeader
        description={
          <>
            Changes apply on every server within 30 seconds and are recorded in the{" "}
            <Link
              className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href="/admin/audit?type=settings"
            >
              audit log
            </Link>
            .
          </>
        }
        title="Settings"
      />

      <SettingsSection
        description={`What each plan allows. Customers see these numbers in the app, on sign-up and in the terms. ${await savedLine(snapshot.saved.plans)}`}
        id="plan-limits"
        title="Plan limits"
      >
        <PlanLimitsForm current={snapshot.plans} defaults={DEFAULT_PLANS} />
      </SettingsSection>

      <SettingsSection
        description={`Which AI model reads receipts. If the active model times out, is rate-limited or has a server error, the next one is tried. A receipt that is unreadable is not sent to another model. All tries share one ${OCR_DEADLINE_MS / 1000}-second limit. ${await savedLine(snapshot.saved.ocr)}`}
        id="ocr-models"
        title="OCR models"
      >
        <OcrChainForm
          available={available}
          current={snapshot.ocr.chain}
          models={models}
          providers={providers}
        />
        <p className="mt-4 text-xs text-muted-foreground">
          API keys stay in the server environment and are never shown here. To add a provider key,
          set it in the environment and redeploy.
        </p>
      </SettingsSection>

      <SettingsSection
        description="Set in the server environment, not here."
        id="daily-cap"
        title="Service-wide daily cap"
      >
        <p className="text-sm">
          {cap === undefined ? (
            <>
              Not set. Set <code className="font-mono text-xs">OCR_DAILY_CAP</code> to limit
              provider calls across all users per UTC day.
            </>
          ) : (
            <>
              <span className="font-mono tabular-nums">{cap.toLocaleString("en-US")}</span> provider
              calls per UTC day across all users (
              <code className="font-mono text-xs">OCR_DAILY_CAP</code>
              ). See today&apos;s count on the{" "}
              <Link
                className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                href="/admin"
              >
                overview
              </Link>
              .
            </>
          )}
        </p>
      </SettingsSection>
    </>
  );
}
