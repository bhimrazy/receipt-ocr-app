import { describe, expect, it } from "vitest";
import { tlsOptions } from "../src/index";

const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const url =
  "postgresql://user:pw@db.example.test:6543/postgres?sslmode=require&application_name=web";

describe("tlsOptions", () => {
  it("leaves the URL to pg when no CA is set", () => {
    expect(tlsOptions(url, undefined)).toEqual({ connectionString: url });
    expect(tlsOptions(url, "  ")).toEqual({ connectionString: url });
  });

  it("verifies against the CA and drops sslmode so it can't override ssl", () => {
    const options = tlsOptions(url, pem);
    expect(options.ssl).toEqual({ ca: pem, rejectUnauthorized: true });
    const parsed = new URL(options.connectionString);
    expect(parsed.searchParams.has("sslmode")).toBe(false);
    expect(parsed.searchParams.get("application_name")).toBe("web");
    expect(parsed.password).toBe("pw");
  });

  it("accepts a PEM stored with escaped newlines", () => {
    expect(tlsOptions(url, pem.replaceAll("\n", "\\n")).ssl?.ca).toBe(pem);
  });
});
