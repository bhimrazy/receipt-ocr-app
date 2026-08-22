import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const authEnabled = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

/**
 * Optimistic auth gate: only checks for the presence of the session cookie
 * (fast, no DB hit) and redirects signed-out visitors of /app to /sign-in.
 * API routes are NOT gated here — they do a real session check server-side
 * via `getSession()`, since a cookie's presence alone proves nothing.
 */
export default function proxy(request: NextRequest) {
  if (!authEnabled) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isGuarded =
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/");
  if (isGuarded) {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      const signInUrl = new URL("/sign-in", request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  // The /admin role check is enforced server-side in app/admin/layout.tsx via
  // requireAdmin(); the cookie check here only weeds out signed-out visitors.
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/app", "/admin/:path*", "/admin"],
};
