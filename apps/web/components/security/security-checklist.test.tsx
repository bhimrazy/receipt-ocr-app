import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SecurityChecklist } from "./security-checklist";

// The server action imports server-only modules; rendering does not call it.
vi.mock("@/app/app/settings/security/actions", () => ({ sendVerificationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const props = {
  email: "a@example.com",
  emailVerified: false,
  strongFactor: false,
  methods: 1,
  readOnly: false,
};

/** The button classes of each action, in order: primary first, outline after. */
const actions = (html: string) =>
  [...html.matchAll(/<(?:a|button)[^>]*class="([^"]*)"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((m) => ({
    label: m[2],
    outline: m[1]!.includes("border-border"),
  }));

describe("SecurityChecklist", () => {
  it("names the heading and the count", () => {
    const html = renderToStaticMarkup(<SecurityChecklist {...props} emailVerified />);
    expect(html).toContain("Account protection</h2>");
    expect(html).toContain("1 of 3</span> done");
  });

  it("makes only the first unmet check's action the primary button", () => {
    const html = renderToStaticMarkup(<SecurityChecklist {...props} />);
    expect(html).toContain("Open the link we emailed to a@example.com.");
    expect(actions(html)).toEqual([
      { label: "Resend link", outline: false },
      { label: "Add a passkey", outline: true },
      { label: "Add another", outline: true },
    ]);
    const next = renderToStaticMarkup(<SecurityChecklist {...props} emailVerified />);
    expect(actions(next)[0]).toEqual({ label: "Add a passkey", outline: false });
  });

  it("collapses to one line when all three are done", () => {
    const html = renderToStaticMarkup(
      <SecurityChecklist {...props} emailVerified methods={2} strongFactor />,
    );
    expect(html).toContain("All three checks done. Your account is well protected.");
    expect(html).not.toContain("<ul");
  });

  it("shows no actions read-only", () => {
    const html = renderToStaticMarkup(<SecurityChecklist {...props} readOnly />);
    expect(html).toContain("0 of 3</span> done");
    expect(actions(html)).toEqual([]);
  });
});
