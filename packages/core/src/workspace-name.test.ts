import { describe, expect, it } from "vitest";
import { parseWorkspaceName, personalWorkspaceName } from "./workspace-name";

describe("parseWorkspaceName", () => {
  it("accepts and trims a normal name", () => {
    expect(parseWorkspaceName("  Acme & Co's books ")).toEqual({
      ok: true,
      name: "Acme & Co's books",
    });
  });

  it.each([
    ["markup", 'Acme</strong><h1 style="color:red">locked</h1>'],
    ["a lone angle bracket", "a > b"],
    ["a newline", "Acme\nVerify your password"],
    ["a C1 control", "Acme\u0085"],
    ["only whitespace", "   "],
    ["more than 80 characters", "x".repeat(81)],
    ["a 20,000-character name", "x".repeat(20_000)],
    ["a non-string", 42],
  ])("rejects %s", (_label, value) => {
    expect(parseWorkspaceName(value).ok).toBe(false);
  });

  it("allows exactly 80 characters", () => {
    expect(parseWorkspaceName("x".repeat(80)).ok).toBe(true);
  });
});

describe("personalWorkspaceName", () => {
  it("always produces a valid workspace name", () => {
    for (const name of ["Ann", "<script>alert(1)</script>", "y".repeat(500), "\n\t", null]) {
      const result = personalWorkspaceName({ name, email: "z@example.com" });
      expect(parseWorkspaceName(result)).toEqual({ ok: true, name: result });
    }
  });

  it("keeps the familiar format", () => {
    expect(personalWorkspaceName({ name: "Ann", email: "a@example.com" })).toBe("Ann's Workspace");
    expect(personalWorkspaceName({ email: "bob@example.com" })).toBe("bob's Workspace");
  });
});
