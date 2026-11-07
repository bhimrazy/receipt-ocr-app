/**
 * Dev-only template sources. Every message follows one format (docs/architecture/email.md): logo
 * and wordmark, one heading, a short body, at most one primary action with its expiry and a short
 * fallback link, a "wasn't you?" note where it matters, and a footer saying why the mail came and
 * where replies go. Values arrive as strings: `{{slot}}` placeholders when generating, real values
 * in the golden tests. Preheaders are fixed text.
 */
import type { ReactElement } from "react";
import {
  Action,
  BRAND,
  InlineLink,
  Layout,
  Note,
  P,
  plainText,
  Strong,
  type Shared,
} from "./layout";

type Values = Record<string, string>;

export interface EmailDefinition {
  /** Slots this template uses beyond the shared ones (appOrigin, appHost, supportEmail). */
  slots: readonly string[];
  render(v: Values, shared: Shared): { html: ReactElement; text: string };
}

/** "contact us at <support>" or the in-app fallback, for security notices. */
function contact(shared: Shared) {
  return shared.supportEmail
    ? {
        html: (
          <>
            contact us at{" "}
            <InlineLink href={`mailto:${shared.supportEmail}`}>{shared.supportEmail}</InlineLink>
          </>
        ),
        text: `contact us at ${shared.supportEmail}`,
      }
    : {
        html: <>contact us from the support button in the app</>,
        text: "contact us from the support button in the app",
      };
}

const verification: EmailDefinition = {
  slots: ["url", "urlLabel", "expiry"],
  render(v, shared) {
    const heading = "Confirm your email address";
    const body = `Thanks for signing up for ${BRAND}. Confirm this is your address to finish setting up your account.`;
    const expiry = `This link expires in ${v.expiry}.`;
    const note = "Didn't sign up? You can ignore this email. Nothing happens without this link.";
    const reason = `You're receiving this because this address was used to create a ${BRAND} account.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader={`One step left: confirm your address to start using ${BRAND}.`}
          heading={heading}
          reason={reason}
        >
          <P>{body}</P>
          <Action label="Confirm email address" url={v.url} urlLabel={v.urlLabel} expiry={expiry} />
          <Note>{note}</Note>
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [body],
        action: { label: "Confirm email address", url: v.url, expiry },
        note,
        reason,
      }),
    };
  },
};

const passwordReset: EmailDefinition = {
  slots: ["url", "urlLabel", "expiry"],
  render(v, shared) {
    const heading = "Reset your password";
    const body = `We got a request to reset the password for your ${BRAND} account. Choose a new one with the button below.`;
    const expiry = `This link expires in ${v.expiry}. Resetting signs you out on every device.`;
    const note =
      "Didn't ask for this? Ignore this email. Your password stays the same unless this link is used.";
    const reason = "You're receiving this because a password reset was requested for this address.";
    return {
      html: (
        <Layout
          shared={shared}
          preheader="Use this link to choose a new password."
          heading={heading}
          reason={reason}
        >
          <P>{body}</P>
          <Action label="Choose a new password" url={v.url} urlLabel={v.urlLabel} expiry={expiry} />
          <Note>{note}</Note>
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [body],
        action: { label: "Choose a new password", url: v.url, expiry },
        note,
        reason,
      }),
    };
  },
};

const invitation: EmailDefinition = {
  slots: ["url", "urlLabel", "expiry", "organizationName", "inviterEmail"],
  render(v, shared) {
    const heading = "You're invited to a workspace";
    const expiry = `This invitation expires in ${v.expiry}. Sign in or sign up with this email address to accept it.`;
    const note = "Not expecting this? You can ignore it. You won't join unless you accept.";
    const reason = `You're receiving this because a ${BRAND} workspace member invited this address.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader="Accept the invitation to share receipts in this workspace."
          heading={heading}
          reason={reason}
        >
          <P>
            <Strong>{v.inviterEmail}</Strong> invited you to join the{" "}
            <Strong>{v.organizationName}</Strong> workspace on {BRAND}, to upload and review
            receipts together.
          </P>
          <Action label="Accept invitation" url={v.url} urlLabel={v.urlLabel} expiry={expiry} />
          <Note>{note}</Note>
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [
          `${v.inviterEmail} invited you to join the "${v.organizationName}" workspace on ${BRAND}, to upload and review receipts together.`,
        ],
        action: { label: "Accept invitation", url: v.url, expiry },
        note,
        reason,
      }),
    };
  },
};

/** A contact-form message to the support inbox. The visitor is the Reply-To, so the footer says so. */
const supportMessage: EmailDefinition = {
  slots: ["from", "topicLabel", "message"],
  render(v, shared) {
    const heading = `${v.topicLabel} from the contact form`;
    const reason = `Sent by the contact form on ${shared.appHost}.`;
    const replyNote = `Reply to this email to answer ${v.from} directly.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader="A new message from the contact form."
          heading={heading}
          reason={reason}
          replyNote={replyNote}
        >
          <P>
            From <Strong>{v.from}</Strong>
          </P>
          <Note>
            <span className="whitespace-pre-wrap">{v.message}</span>
          </Note>
        </Layout>
      ),
      text: plainText(shared, { heading, body: [`From ${v.from}`, v.message], reason, replyNote }),
    };
  },
};

const test: EmailDefinition = {
  slots: [],
  render(_v, shared) {
    const heading = "Email delivery works";
    const body = `This test was sent from the ${BRAND} admin console. Because it arrived, sign-up confirmations, password resets and invitations can reach people too.`;
    const reason = "You're receiving this because you sent a test from the admin console.";
    return {
      html: (
        <Layout
          shared={shared}
          preheader="Your test message arrived, so transactional email is working."
          heading={heading}
          reason={reason}
        >
          <P>{body}</P>
        </Layout>
      ),
      text: plainText(shared, { heading, body: [body], reason }),
    };
  },
};

/** Step-up confirmation before an account is deleted; the only red button. */
const deleteAccount: EmailDefinition = {
  slots: ["url", "urlLabel", "expiry"],
  render(v, shared) {
    const heading = "Confirm deleting your account";
    const body = `Someone signed in to your account asked to delete it. Open this link within ${v.expiry} and confirm on the page it opens to permanently delete the account, its workspaces and every receipt in them. Until then, nothing changes.`;
    const expiry = `The link works once and expires in ${v.expiry}.`;
    const note =
      "Wasn't you? Don't open the link. Change your password, or the password of the Google or GitHub account you sign in with, because someone else can use your account.";
    const reason = `You're receiving this because deleting this ${BRAND} account was requested while signed in.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader="Confirm to permanently delete your account. Not you? Don't open the link."
          heading={heading}
          reason={reason}
        >
          <P>{body}</P>
          <Action
            label="Delete my account"
            url={v.url}
            urlLabel={v.urlLabel}
            expiry={expiry}
            tone="danger"
          />
          <Note>{note}</Note>
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [body],
        action: { label: "Delete my account", url: v.url, expiry },
        note,
        reason,
      }),
    };
  },
};

/** Security notice after a password change; the action is the recovery path. */
const passwordChanged: EmailDefinition = {
  slots: ["resetUrl", "resetUrlLabel"],
  render(v, shared) {
    const heading = "Your password was changed";
    const body = `The password for your ${BRAND} account was just changed. If that was you, there's nothing to do.`;
    const help = contact(shared);
    const reason = `You're receiving this because the password for this ${BRAND} account changed.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader="If this wasn't you, reset your password now."
          heading={heading}
          reason={reason}
        >
          <P>{body}</P>
          <Note className="mb-6">Wasn&apos;t you? Reset your password now and {help.html}.</Note>
          <Action label="Reset password" url={v.resetUrl} urlLabel={v.resetUrlLabel} />
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [body, `Wasn't you? Reset your password now and ${help.text}.`],
        action: { label: "Reset password", url: v.resetUrl },
        reason,
      }),
    };
  },
};

/**
 * Goes to the current address, which must approve the change (Better Auth's `url`) before the new
 * address gets its own verification email. The reset link is the "wasn't you?" path.
 */
const emailChange: EmailDefinition = {
  slots: ["url", "urlLabel", "expiry", "newEmail", "resetUrl"],
  render(v, shared) {
    const heading = "Approve the email change";
    const expiry = `This link expires in ${v.expiry}.`;
    const help = contact(shared);
    const reason = `You're receiving this because this is the sign-in address of a ${BRAND} account.`;
    const body = `Nothing changes until you approve it here and then confirm the new address from the email we send there.`;
    return {
      html: (
        <Layout
          shared={shared}
          preheader="Approve the change, or ignore this email to keep your current address."
          heading={heading}
          reason={reason}
        >
          <P>
            Someone signed in to your account asked to change its email address to{" "}
            <Strong>{v.newEmail}</Strong>. {body}
          </P>
          <Action label="Approve the change" url={v.url} urlLabel={v.urlLabel} expiry={expiry} />
          <Note>
            Wasn&apos;t you? Don&apos;t open the link.{" "}
            <InlineLink href={v.resetUrl}>Reset your password</InlineLink> and {help.html}.
          </Note>
        </Layout>
      ),
      text: plainText(shared, {
        heading,
        body: [
          `Someone signed in to your ${BRAND} account asked to change its email address to ${v.newEmail}. ${body}`,
        ],
        action: { label: "Approve the change", url: v.url, expiry },
        note: `Wasn't you? Don't open the link. Reset your password and ${help.text}: ${v.resetUrl}`,
        reason,
      }),
    };
  },
};

export const definitions = {
  verification,
  passwordReset,
  invitation,
  supportMessage,
  test,
  deleteAccount,
  passwordChanged,
  emailChange,
} satisfies Record<string, EmailDefinition>;

export type TemplateName = keyof typeof definitions;
