/**
 * Dev-only React Email layout. `scripts/generate.ts` renders it once per template with `{{slot}}`
 * placeholders into `src/generated.ts`; production fills the slots without React or Tailwind.
 * Every prop here is a ready-made string (a placeholder or, in the golden tests, the real value).
 */
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

/** Values every message needs: the app origin and host, and the support inbox when there is one. */
export interface Shared {
  appOrigin: string;
  appHost: string;
  supportEmail?: string;
}

const text = "m-0 text-[16px] leading-[26px] text-body dark:text-d-body";
const small = "m-0 text-[14px] leading-[22px] text-muted dark:text-d-muted";
const footer = "m-0 text-[13px] leading-[20px] text-muted dark:text-d-muted";

export function P({ children }: { children: ReactNode }) {
  return <Text className={`${text} mb-4`}>{children}</Text>;
}

/** Inline emphasis for names and addresses; long unbroken values wrap instead of overflowing. */
export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold break-words text-ink dark:text-d-ink">{children}</strong>;
}

/** An inline link inside body copy or a note. */
export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent underline dark:text-d-accent">
      {children}
    </Link>
  );
}

const tones = {
  primary: "bg-accent text-accent-fg dark:bg-d-accent dark:text-d-accent-fg",
  danger: "bg-danger text-danger-fg dark:bg-d-danger dark:text-d-danger-fg",
};

/** The one primary action, then its expiry and a one-line fallback link (`urlLabel` is its visible text). */
export function Action(props: {
  label: string;
  url: string;
  urlLabel: string;
  expiry?: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <Section className="mt-2 mb-6">
      {/* react-email's Button pads with mso-padding/mso-text-raise for Outlook; 16px text + 2x14px padding = 52px tall. */}
      <Button
        href={props.url}
        className={`box-border rounded-[8px] px-6 py-[14px] text-[16px] leading-[24px] font-semibold no-underline ${tones[props.tone ?? "primary"]}`}
      >
        {props.label}
      </Button>
      {props.expiry ? <Text className={`${small} mt-4`}>{props.expiry}</Text> : null}
      <Text className={`${small} mt-2`}>
        Button not working? Open this link:
        <br />
        <Link
          href={props.url}
          className="font-mono text-[13px] break-all text-accent underline dark:text-d-accent"
        >
          {props.urlLabel}
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
      <Text className="m-0 px-4 py-3 text-[14px] leading-[22px] break-words text-body dark:text-d-body">
        {children}
      </Text>
    </Section>
  );
}

/** "Questions?" line: replies reach the support inbox when there is one, else the in-app form. */
function ReplyNote({ supportEmail }: { supportEmail?: string }) {
  if (!supportEmail) return <>Questions? Use the support button in the app.</>;
  return (
    <>
      Questions? Reply to this email or write to{" "}
      <Link href={`mailto:${supportEmail}`} className="text-muted underline dark:text-d-muted">
        {supportEmail}
      </Link>
      .
    </>
  );
}

export interface LayoutProps {
  shared: Shared;
  /** Inbox preview text: fixed per template, never user input. */
  preheader: string;
  heading: ReactNode;
  /** Footer line: why this address got the message. */
  reason: ReactNode;
  /** Replaces the default "Questions?" footer line. */
  replyNote?: ReactNode;
  children: ReactNode;
}

export function Layout({ shared, preheader, heading, reason, replyNote, children }: LayoutProps) {
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
                      src={`${shared.appOrigin}/icons/icon-192.png`}
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
                    className="m-0 mb-4 text-[24px] leading-[32px] font-semibold tracking-tight break-words text-ink dark:text-d-ink"
                  >
                    {heading}
                  </Heading>
                  {children}
                </Section>
              </Section>
              <Section className="px-1 pt-6">
                <Text className={`${footer} mb-2`}>{reason}</Text>
                <Text className={`${footer} mb-2`}>
                  {replyNote ?? <ReplyNote supportEmail={shared.supportEmail} />}
                </Text>
                <Text className={footer}>
                  {BRAND} ·{" "}
                  <Link
                    href={`${shared.appOrigin}/`}
                    className="text-muted underline dark:text-d-muted"
                  >
                    {shared.appHost}
                  </Link>{" "}
                  ·{" "}
                  <Link
                    href={`${shared.appOrigin}/privacy`}
                    className="text-muted underline dark:text-d-muted"
                  >
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
  shared: Shared,
  parts: {
    heading: string;
    body: string[];
    action?: { label: string; url: string; expiry?: string };
    note?: string;
    reason: string;
    replyNote?: string;
  },
): string {
  const lines = [BRAND, "", parts.heading, "", ...parts.body.flatMap((p) => [p, ""])];
  if (parts.action) {
    lines.push(`${parts.action.label}:`, parts.action.url, "");
    if (parts.action.expiry) lines.push(parts.action.expiry, "");
  }
  if (parts.note) lines.push(parts.note, "");
  const reply =
    parts.replyNote ??
    (shared.supportEmail
      ? `Questions? Reply to this email or write to ${shared.supportEmail}.`
      : "Questions? Use the support button in the app.");
  lines.push(
    "--",
    parts.reason,
    reply,
    `${BRAND} · ${shared.appOrigin} · Privacy: ${shared.appOrigin}/privacy`,
  );
  return lines.join("\n");
}
