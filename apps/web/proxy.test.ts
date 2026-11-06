import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "./proxy";

const location = (url: string, cookie?: string) =>
  proxy(new NextRequest(url, cookie ? { headers: { cookie } } : undefined)).headers.get("location");

describe("proxy", () => {
  it("sends signed-out visitors to sign-in with the page they wanted", () => {
    const to = new URL(location("http://localhost/app/history?status=failed&q=shell")!);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.get("redirect")).toBe("/app/history?status=failed&q=shell");
    expect(new URL(location("http://localhost/admin")!).searchParams.get("redirect")).toBe(
      "/admin",
    );
  });

  it("lets requests with a session cookie through", () => {
    expect(location("http://localhost/app", "better-auth.session_token=abc")).toBeNull();
  });

  it("hands the requested path to server components, ignoring a spoofed header", () => {
    const res = proxy(
      new NextRequest("http://localhost/app/history?status=failed", {
        headers: { cookie: "better-auth.session_token=abc", "x-requested-path": "//evil.example" },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-requested-path")).toBe(
      "/app/history?status=failed",
    );
  });

  it("sets the landing-page hint for signed-in visits and clears it on redirect", () => {
    const signedIn = proxy(
      new NextRequest("http://localhost/app", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );
    expect(signedIn.cookies.get("signed_in_hint")?.value).toBe("1");

    const signedOut = proxy(
      new NextRequest("http://localhost/app", { headers: { cookie: "signed_in_hint=1" } }),
    );
    expect(signedOut.cookies.get("signed_in_hint")?.value).toBe("");
  });
});
