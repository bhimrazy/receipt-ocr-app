import { getSessionCookie } from "better-auth/cookies";
import { REQUESTED_PATH_HEADER } from "@/lib/redirect";
import { SIGNED_IN_HINT_COOKIE } from "@/lib/signed-in-hint";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate: only checks for the presence of the session cookie
 * (fast, no DB hit) and redirects signed-out visitors of /app to /sign-in.
 * API routes are NOT gated here — they do a real session check server-side
 * via `getSession()`, since a cookie's presence alone proves nothing.
 * There is no signed-out view of /app: with auth unconfigured nobody has a
 * cookie, so everyone lands on /sign-in, which says sign-in isn't set up.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isGuarded =
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");
  const requestHeaders = new Headers(request.headers);
  let signedIn = false;
  requestHeaders.delete(REQUESTED_PATH_HEADER);
  if (isGuarded) {
    requestHeaders.set(REQUESTED_PATH_HEADER, `${pathname}${request.nextUrl.search}`);
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      const signInUrl = new URL("/sign-in", request.url);
      // Only the guarded path itself, so it is always a same-origin relative path;
      // the sign-in page still runs it through safeRedirect().
      signInUrl.searchParams.set("redirect", `${pathname}${request.nextUrl.search}`);
      const redirect = NextResponse.redirect(signInUrl);
      if (request.cookies.has(SIGNED_IN_HINT_COOKIE))
        redirect.cookies.delete(SIGNED_IN_HINT_COOKIE);
      return redirect;
    }
    signedIn = true;
  }

  // The /admin role check is enforced server-side in app/admin/layout.tsx via
  // requireAdmin(); the cookie check here only weeds out signed-out visitors.
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (signedIn && request.cookies.get(SIGNED_IN_HINT_COOKIE)?.value !== "1") {
    // Readable by the landing page, which is static and cannot see the HttpOnly session cookie.
    response.cookies.set(SIGNED_IN_HINT_COOKIE, "1", {
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/app", "/admin/:path*", "/admin"],
};
