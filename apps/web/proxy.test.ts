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
});
