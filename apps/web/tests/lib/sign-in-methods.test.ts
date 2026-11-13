import { describe, expect, it } from "vitest";
import { linkErrorMessage, linkOutcome } from "@/lib/sign-in-methods";

const labels = { google: "Google", github: "GitHub" };

describe("linkOutcome", () => {
  it("confirms a connected provider", () => {
    expect(linkOutcome({ linked: "github" }, labels, "a@example.com")).toEqual({
      ok: true,
      message: "GitHub is connected.",
    });
  });

  it("explains a refused link by provider", () => {
    expect(
      linkOutcome({ link: "google", error: "email_does_not_match" }, labels, "a@example.com"),
    ).toEqual({
      ok: false,
      message:
        "That Google account uses a different email address. Connect one that uses a@example.com.",
    });
  });

  it("ignores unknown providers and a missing error", () => {
    expect(linkOutcome({ linked: "twitter" }, labels, "a@example.com")).toBeNull();
    expect(linkOutcome({ link: "google" }, labels, "a@example.com")).toBeNull();
  });
});

describe("linkErrorMessage", () => {
  it("never echoes an unknown code", () => {
    expect(linkErrorMessage("<script>", "GitHub", "a@example.com")).toBe(
      "We couldn't connect GitHub. Try again.",
    );
  });
});
