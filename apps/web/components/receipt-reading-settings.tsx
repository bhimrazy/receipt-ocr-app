import { providerNames, readingSentence, type Reader } from "@/lib/receipt-reading";
import Link from "next/link";
import { SettingsSection } from "./settings-section";

/** Read-only: which model reads the user's receipts. Rendered on the server from the settings service. */
export function ReceiptReadingSettings({ readers }: { readers: readonly Reader[] }) {
  const sentence = readingSentence(readers);
  const providers = providerNames(readers);
  return (
    <SettingsSection
      description="Which AI model reads your receipts."
      id="reading-heading"
      title="Receipt reading"
    >
      {sentence ? (
        <>
          <p className="text-sm">{sentence}</p>
          {providers.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              We choose these models and may change them. Our{" "}
              <Link
                className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                href="/privacy"
              >
                privacy policy
              </Link>{" "}
              explains how your receipts are handled by {providers.join(" and ")}.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-warning">
          Receipt reading is temporarily unavailable. Uploads will work again once it is back.
        </p>
      )}
    </SettingsSection>
  );
}
