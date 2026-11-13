import { describe, expect, it } from "vitest";
import {
  CONNECTION_STATUS_LABELS,
  statusTone,
  testEmailMessage,
} from "@/app/admin/settings/connection-status";

describe("connection status display", () => {
  it("only a working service is green, and every status has a label", () => {
    for (const status of Object.keys(
      CONNECTION_STATUS_LABELS,
    ) as (keyof typeof CONNECTION_STATUS_LABELS)[]) {
      expect(CONNECTION_STATUS_LABELS[status]).toBeTruthy();
      expect(statusTone(status) === "success").toBe(status === "ok");
    }
  });

  it("names the env vars when email isn't set up", () => {
    expect(testEmailMessage("not-configured").text).toContain("RESEND_API_KEY");
    expect(testEmailMessage("sent").ok).toBe(true);
    expect(testEmailMessage("failed").ok).toBe(false);
  });
});
