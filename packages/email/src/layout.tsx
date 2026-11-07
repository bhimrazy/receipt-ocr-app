import type { ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "react-email";
import { tailwindConfig } from "./theme";

export const BRAND = "receiptOCR";

/** Where the app lives and who answers replies. The web app passes these; this package reads no env. */
export interface EmailContext {
  /** Absolute origin, e.g. https://receipt-ocr.bhimraj.com.np. Links and the logo hang off it. */
  appUrl: string;
  /** Shown in the footer; the mailer's default Reply-To goes there too. */
  supportEmail?: string;
}

/** Only absolute http(s) URLs go into a message: a relative link is dead in a mail client. */
export function absoluteUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Email links must be http(s), got ${url.protocol}`);
  }
  return url.toString();
}

export function appLinks(ctx: EmailContext) {
  const origin = new URL(absoluteUrl(ctx.appUrl)).origin;
  return {
    origin,
    host: new URL(origin).host,
    logo: `${origin}/icons/icon-192.png`,
    privacy: `${origin}/privacy`,
  };
}

/**
 * The fallback link's visible text: the host (so the reader sees where it goes) and the path when
 * it is short; never the token. 30 monospace characters fit one line in a 360px-wide client.
 * The href stays complete, and the plain-text part carries the full URL to copy.
 */
export function displayUrl(value: string, max = 30): string {
  const url = new URL(value);
  const shown = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  return shown.length > max ? `${url.host}/…` : shown;
}

const text = "m-0 text-[16px] leading-[26px] text-body dark:text-d-body";

export function P({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Text className={`${text} mb-4 ${className}`}>{children}</Text>;
}

/** Inline emphasis for names and addresses (already plain text; React escapes them). */
export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink dark:text-d-ink">{children}</strong>;
}

/** The one primary action, plus its expiry and a short fallback link. */
export function Action({ label, url, expiry }: { label: string; url: string; expiry?: string }) {
  const href = absoluteUrl(url);
  return (
    <Section className="mt-2 mb-6">
      {/* react-email's Button pads with mso-padding/mso-text-raise for Outlook; 16px text + 2x14px padding = 52px tall. */}
      <Button
        href={href}
        className="box-border rounded-[8px] bg-accent px-6 py-[14px] text-[16px] leading-[24px] font-semibold text-accent-fg no-underline dark:bg-d-accent dark:text-d-accent-fg"
      >
        {label}
      </Button>
      {expiry ? (
        <Text className="m-0 mt-4 text-[14px] leading-[22px] text-muted dark:text-d-muted">
          {expiry}
        </Text>
      ) : null}
      <Text className="m-0 mt-2 text-[14px] leading-[22px] text-muted dark:text-d-muted">
        Button not working? Open this link:
        <br />
        <Link
          href={href}
          className="font-mono text-[13px] break-all text-accent underline dark:text-d-accent"
        >
          {displayUrl(href)}
        </Link>
      </Text>
    </Section>
  );
}

/** A quieter, bordered note: the "wasn't you?" line every security-relevant message carries. */
export function Note({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <Section
      className={`mt-2 ${className} rounded-[8px] border border-solid border-line bg-canvas dark:border-d-line dark:bg-d-canvas`}
    >
      <Text className="m-0 px-4 py-3 text-[14px] leading-[22px] text-body dark:text-d-body">
        {children}
      </Text>
    </Section>
  );
}

export interface LayoutProps {
  ctx: EmailContext;
  /** Inbox preview text (40-110 characters reads best). */
  preheader: string;
  heading: string;
  /** Footer line: why this address got the message. */
  reason: string;
  /** Footer line about replies; defaults to "replies reach support". */
  replyNote?: ReactNode;
  children: ReactNode;
}

export function Layout({ ctx, preheader, heading, reason, replyNote, children }: LayoutProps) {
  const links = appLinks(ctx);
  return (
    <Html lang="en" dir="ltr">
      <Tailwind config={tailwindConfig}>
        <Head>
          <meta name="color-scheme" content="light dark" />
          <meta name="supported-color-schemes" content="light dark" />
          <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no" />
          <style>{":root{color-scheme:light dark;supported-color-schemes:light dark}"}</style>
        </Head>
        <Preview>{preheader}</Preview>
        <Body className="m-0 bg-canvas p-0 dark:bg-d-canvas">
          {/* Gmail drops <body> styles, so the canvas colour and padding sit on a full-width table. */}
          <Section className="w-full bg-canvas px-3 py-8 font-sans dark:bg-d-canvas">
            <Container className="mx-auto w-full max-w-[560px]">
              <Section className="px-1 pb-5">
                <Row>
                  <Column className="w-[40px] align-middle">
                    {/* Decorative: the wordmark beside it is live text, so image-off clients still show the name. */}
                    <Img
                      src={links.logo}
                      width="32"
                      height="32"
                      alt=""
                      className="block rounded-[7px]"
                    />
                  </Column>
                  <Column className="align-middle">
                    <Text className="m-0 font-mono text-[16px] leading-[24px] font-semibold tracking-tight text-ink dark:text-d-ink">
                      receipt<span className="text-accent dark:text-d-accent">OCR</span>
                    </Text>
                  </Column>
                </Row>
              </Section>
              <Section className="rounded-[12px] border border-solid border-line bg-surface dark:border-d-line dark:bg-d-surface">
                <Section className="px-7 pt-8 pb-6">
                  <Heading
                    as="h1"
                    className="m-0 mb-4 text-[24px] leading-[32px] font-semibold tracking-tight text-ink dark:text-d-ink"
                  >
                    {heading}
                  </Heading>
                  {children}
                </Section>
              </Section>
              <Section className="px-1 pt-6">
                <Text className="m-0 mb-2 text-[13px] leading-[20px] text-muted dark:text-d-muted">
                  {reason}
                </Text>
                <Text className="m-0 mb-2 text-[13px] leading-[20px] text-muted dark:text-d-muted">
                  {replyNote ?? (
                    <>
                      Questions? Reply to this email
                      {ctx.supportEmail ? (
                        <>
                          {" "}
                          or write to{" "}
                          <Link
                            href={`mailto:${ctx.supportEmail}`}
                            className="text-muted underline dark:text-d-muted"
                          >
                            {ctx.supportEmail}
                          </Link>
                        </>
                      ) : null}
                      .
                    </>
                  )}
                </Text>
                <Text className="m-0 text-[13px] leading-[20px] text-muted dark:text-d-muted">
                  {BRAND} ·{" "}
                  <Link
                    href={`${links.origin}/`}
                    className="text-muted underline dark:text-d-muted"
                  >
                    {links.host}
                  </Link>{" "}
                  ·{" "}
                  <Link href={links.privacy} className="text-muted underline dark:text-d-muted">
                    Privacy
                  </Link>
                </Text>
              </Section>
            </Container>
          </Section>
        </Body>
      </Tailwind>
    </Html>
  );
}

/** Plain-text twin of the layout: same order, full URLs, no markup. */
export function plainText(
  ctx: EmailContext,
  parts: {
    heading: string;
    body: string[];
    action?: { label: string; url: string; expiry?: string };
    note?: string;
    reason: string;
    replyNote?: string;
  },
): string {
  const links = appLinks(ctx);
  const lines = [BRAND, "", parts.heading, "", ...parts.body.flatMap((p) => [p, ""])];
  if (parts.action) {
    lines.push(`${parts.action.label}:`, absoluteUrl(parts.action.url), "");
    if (parts.action.expiry) lines.push(parts.action.expiry, "");
  }
  if (parts.note) lines.push(parts.note, "");
  const reply =
    parts.replyNote ??
    `Questions? Reply to this email${ctx.supportEmail ? ` or write to ${ctx.supportEmail}` : ""}.`;
  lines.push("--", parts.reason, reply, `${BRAND} · ${links.origin} · Privacy: ${links.privacy}`);
  return lines.join("\n");
}
