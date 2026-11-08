import { contentLlmsSections } from "@/lib/content";
import { homeFaqs } from "@/lib/home-faqs";
import { PRO_PRICE_LABEL } from "@/lib/pricing";
import { OWNER, REPO_URL, homeDescription } from "@/lib/seo";
import { isProductionHost, requestHost } from "@/lib/seo-hosts";
import { SITE_NAME, siteUrl } from "@/lib/site";

const abs = (path: string) => new URL(path, siteUrl).toString();

const pages = [
  ["Home", abs("/"), "product overview, how it works, pricing and FAQ"],
  [
    "Pricing",
    abs("/pricing"),
    `Free ($0) and Pro (${PRO_PRICE_LABEL.month} a month or ${PRO_PRICE_LABEL.year} a year per workspace, plus tax)`,
  ],
  ["Refund policy", abs("/refunds"), "refunds for Pro subscriptions, handled by Paddle"],
  ["FAQ", abs("/#faq"), "file formats, accuracy, where data is stored, export"],
  ["Privacy policy", abs("/privacy"), "what is collected and how it is used"],
  ["Terms of service", abs("/terms"), "the terms of using ReceiptOCR"],
  ["Cookie policy", abs("/cookies"), "which cookies are used and how to change your choice"],
] as const;

const summary = `> ${homeDescription}`;

/** Concise llms.txt (llmstxt.org format). */
export function llmsTxt(): string {
  return [
    `# ${SITE_NAME}`,
    "",
    summary,
    "",
    "Upload a receipt photo or PDF (JPEG, PNG, WebP, HEIC, PDF) and get the merchant, date, line items, tax and total as rows you can check and export as CSV or copy as JSON. Each receipt and each line has a confidence score, and totals that do not add up are flagged. Receipts are private to a workspace that can be shared with teammates. The web app installs as a PWA on iOS and Android.",
    "",
    "## Pages",
    "",
    ...pages.map(([label, url, note]) => `- [${label}](${url}): ${note}`),
    "",
    ...contentLlmsSections(),
    "## Open source and contact",
    "",
    `- [Source code](${REPO_URL}): the open-source repository; open an issue there for questions and bugs`,
    `- [Maintainer](${OWNER.url}): ${OWNER.name}`,
    "- Support: the support button on every page reaches the team",
    "",
    "## Optional",
    "",
    `- [Full text](${abs("/llms-full.txt")}): product details and FAQ in one file`,
    "",
  ].join("\n");
}

/** llms-full.txt: the concise file plus the FAQ and plan details, all from facts shown on the site. */
export function llmsFullTxt(): string {
  return [
    llmsTxt()
      .replace(/## Optional[\s\S]*$/, "")
      .trimEnd(),
    "",
    "## Plans",
    "",
    "- Free: $0, no credit card. Daily and monthly scan limits per person, across every Free workspace; merchant, items, tax and totals extracted; confidence scores and review flags; searchable receipt history; CSV export and JSON copy. Own 1 workspace.",
    `- Pro: ${PRO_PRICE_LABEL.month} a month or ${PRO_PRICE_LABEL.year} a year for one workspace, plus sales tax or VAT (Paddle is the merchant of record). Everything in Free, with a larger monthly scan allowance shared by everyone in the workspace. Own up to 2 workspaces, each upgraded separately. Cancel any time. Current limits: ${abs("/pricing")}.`,
    "",
    "## FAQ",
    "",
    ...homeFaqs.flatMap((faq) => [`### ${faq.q}`, "", faq.a, ""]),
  ].join("\n");
}

/** A plain-text response on the production host, 404 on any other. */
export function llmsResponse(request: Request, body: () => string): Response {
  if (!isProductionHost(requestHost(request.headers))) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  return new Response(body(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
