import { describe, expect, it } from "vitest";
import { logStorageName } from "./processors";

describe("logStorageName", () => {
  it("names Axiom only for its endpoints, and nothing when export is off", () => {
    expect(logStorageName(undefined)).toBeNull();
    expect(logStorageName(" ")).toBeNull();
    expect(logStorageName("https://api.axiom.co")).toBe("Axiom");
    expect(logStorageName("https://eu-central-1.aws.edge.axiom.co")).toBe("Axiom");
    expect(logStorageName("https://axiom.co.evil.example")).toBe("A log storage provider");
    expect(logStorageName("http://otel-collector:4318")).toBe("A log storage provider");
  });
});
