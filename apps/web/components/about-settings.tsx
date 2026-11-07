import { Card } from "@receipt-ocr/ui/components/card";
import Link from "next/link";
import { GitHubIcon } from "@/components/github-icon";
import { SettingsSection } from "@/components/settings-section";
import { authorName, authorUrl, repoUrl } from "@/lib/site";
import pkg from "../package.json";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8";

export function AboutSettings() {
  // Set by Vercel builds; absent in local and Docker builds.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return (
    <SettingsSection
      description="Who makes receiptOCR and where to find the code."
      id="about-heading"
      title="About"
    >
      <Card className="flex flex-col gap-1 p-4 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">receiptOCR</span>
          <span className="font-mono text-xs text-muted-foreground">
            v{pkg.version}
            {commit ? ` · ${commit}` : ""}
          </span>
        </p>
        <p className="text-muted-foreground">
          A product by{" "}
          <a
            className={`${linkClass} text-foreground`}
            href={authorUrl}
            rel="noopener"
            target="_blank"
          >
            {authorName}
          </a>
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-5">
          <li>
            <a
              className={`${linkClass} gap-1.5 text-muted-foreground hover:text-foreground`}
              href={repoUrl}
              rel="noopener"
              target="_blank"
            >
              <GitHubIcon className="size-3.5" />
              Open source on GitHub
            </a>
          </li>
          {[
            ["Terms", "/terms"],
            ["Privacy", "/privacy"],
          ].map(([label, href]) => (
            <li key={href}>
              <Link
                className={`${linkClass} text-muted-foreground hover:text-foreground`}
                href={href!}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </SettingsSection>
  );
}
