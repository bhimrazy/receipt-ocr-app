import { describe, expect, it } from "vitest";
import { checkCronAuth } from "@/lib/cron-auth";

const SECRET = "s3cret-".repeat(6);

describe("checkCronAuth", () => {
  it("accepts the exact bearer secret", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, SECRET)).toBe("ok");
  });

  it("rejects a missing header, a wrong secret, a prefix, a longer value and other schemes", () => {
    expect(checkCronAuth(null, SECRET)).toBe("unauthorized");
    expect(checkCronAuth("", SECRET)).toBe("unauthorized");
    expect(checkCronAuth("Bearer nope", SECRET)).toBe("unauthorized");
    expect(checkCronAuth(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe("unauthorized");
    expect(checkCronAuth(`Bearer ${SECRET}x`, SECRET)).toBe("unauthorized");
    expect(checkCronAuth(`Basic ${SECRET}`, SECRET)).toBe("unauthorized");
    expect(checkCronAuth(SECRET, SECRET)).toBe("unauthorized");
  });

  it("refuses everything when no secret is configured, even an empty bearer", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, undefined)).toBe("unconfigured");
    expect(checkCronAuth("Bearer ", undefined)).toBe("unconfigured");
    expect(checkCronAuth("Bearer ", "")).toBe("unconfigured");
  });
});
