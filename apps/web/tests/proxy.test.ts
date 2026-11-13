import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "@/proxy";

const location = (url: string, cookie?: string) =>
  proxy(new NextRequest(url, cookie ? { headers: { cookie } } : undefined)).headers.get("location");

describe("proxy", () => {
  it("sends signed-out visitors to sign-in with the page they wanted", () => {
    const to = new URL(location("http://localhost/app/receipts?status=failed&q=shell")!);
    expect(to.pathname).toBe("/sign-in");
    expect(to.searchParams.get("redirect")).toBe("/app/receipts?status=failed&q=shell");
    expect(new URL(location("http://localhost/admin")!).searchParams.get("redirect")).toBe(
      "/admin",
    );
  });

  it("lets requests with a session cookie through", () => {
    expect(location("http://localhost/app", "better-auth.session_token=abc")).toBeNull();
  });

  it("hands the requested path to server components, ignoring a spoofed header", () => {
    const res = proxy(
      new NextRequest("http://localhost/app/receipts?status=failed", {
        headers: { cookie: "better-auth.session_token=abc", "x-requested-path": "//evil.example" },
      }),
    );
    expect(res.headers.get("x-middleware-request-x-requested-path")).toBe(
      "/app/receipts?status=failed",
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

  it("sets the hint readable by scripts, scoped to the site, for 30 days", () => {
    const res = proxy(
      new NextRequest("http://localhost/app", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );
    expect(res.cookies.get("signed_in_hint")).toMatchObject({
      value: "1",
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
    expect(res.cookies.get("signed_in_hint")?.httpOnly).toBeFalsy();
  });

  it("leaves the hint alone when it is already set", () => {
    const res = proxy(
      new NextRequest("http://localhost/app", {
        headers: { cookie: "better-auth.session_token=abc; signed_in_hint=1" },
      }),
    );
    expect(res.cookies.get("signed_in_hint")).toBeUndefined();
  });

  it("sends a first launch of the installed app to sign-up, and anyone who signed in before to sign-in", () => {
    const first = new URL(location("http://localhost/app?source=pwa")!);
    expect(first.pathname).toBe("/sign-up");
    expect(first.searchParams.get("redirect")).toBe("/app");

    const returning = new URL(location("http://localhost/app?source=pwa", "has_account=1")!);
    expect(returning.pathname).toBe("/sign-in");
    expect(returning.searchParams.get("redirect")).toBe("/app?source=pwa");

    expect(new URL(location("http://localhost/app")!).pathname).toBe("/sign-in");
    // Only the start URL itself: a deep link that happens to carry the query is a normal visit.
    expect(new URL(location("http://localhost/app/receipts?source=pwa")!).pathname).toBe(
      "/sign-in",
    );
  });

  it("remembers for a year, through sign-out, that this browser has an account", () => {
    const res = proxy(
      new NextRequest("http://localhost/app", {
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );
    expect(res.cookies.get("has_account")).toMatchObject({
      value: "1",
      path: "/",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    });
    const again = proxy(
      new NextRequest("http://localhost/app", {
        headers: { cookie: "better-auth.session_token=abc; has_account=1" },
      }),
    );
    expect(again.cookies.get("has_account")).toBeUndefined();
  });
});
