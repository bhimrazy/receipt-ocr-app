import { describe, expect, it } from "vitest";
import { RANK, roleLabel, toRole } from "./roles";

describe("toRole", () => {
  it("keeps known roles", () => {
    expect(toRole("owner")).toBe("owner");
    expect(toRole("admin")).toBe("admin");
    expect(toRole("member")).toBe("member");
  });

  it("treats unknown or missing roles as the least-privileged one", () => {
    expect(toRole("owner,admin")).toBe("member");
    expect(toRole("superuser")).toBe("member");
    expect(toRole(null)).toBe("member");
  });

  it("ranks and labels roles", () => {
    expect(RANK.owner > RANK.admin && RANK.admin > RANK.member).toBe(true);
    expect(roleLabel("admin")).toBe("Manager");
  });
});
