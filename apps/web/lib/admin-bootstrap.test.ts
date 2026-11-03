import { describe, expect, it } from "vitest";
import { isBootstrapAdmin } from "./admin-bootstrap";

describe("isBootstrapAdmin (B2)", () => {
  const admins = ["boss@corp.test"];

  it("never promotes an unverified sign-up, even with a listed email", () => {
    expect(isBootstrapAdmin({ email: "boss@corp.test", emailVerified: false }, admins)).toBe(false);
  });

  it("promotes a verified listed email, case-insensitively", () => {
    expect(isBootstrapAdmin({ email: "Boss@Corp.test", emailVerified: true }, admins)).toBe(true);
  });

  it("ignores verified emails that are not listed", () => {
    expect(isBootstrapAdmin({ email: "intern@corp.test", emailVerified: true }, admins)).toBe(false);
  });
});
