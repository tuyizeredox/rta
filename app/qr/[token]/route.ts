import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/jwt";
import { getEnv } from "@/lib/env";
import { redeemQrToken } from "@/lib/auth/qr-access";
import { sessionCookieOptions } from "@/lib/auth/session";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  getUserAgent,
  rateLimitKey,
} from "@/lib/api/rate-limit";

/**
 * GET /qr/:token — the destination a scanned sign-in QR code opens.
 *
 * A route handler rather than a page, because this has to write the session
 * cookie and a server component cannot. It never renders anything itself: it
 * either signs the holder in and sends them to their account status, or sends
 * them to a page that explains what to do instead.
 *
 * WHY THE LANDING PAGE IS ACCOUNT STATUS AND NOT THE DASHBOARD. Someone who
 * has just held a card up to a camera is asking one question — "am I in good
 * standing, and what is my balance" — and the honest answer to it is a poor
 * fit for a screen of charts. They reach the full dashboard from there with
 * one tap.
 *
 * ON THE TOKEN BEING IN A URL. It is, and it therefore lands in browser
 * history the same way an emailed magic link does. That is the accepted cost
 * of a code a phone camera can act on unaided; it is bounded by the code's
 * expiry, by one-click regeneration, and by `Referrer-Policy:
 * strict-origin-when-cross-origin` in middleware.ts, which keeps the path out
 * of outbound Referer headers.
 */

// Signing someone in must never be served from a cache.
export const dynamic = "force-dynamic";

/**
 * Redirect targets are resolved against APP_URL, never against `request.url`.
 *
 * In a container the server binds 0.0.0.0 on the platform's port, so a route
 * handler sees that bind address as the request origin rather than the public
 * hostname the scanner actually reached. `NextResponse.redirect` sends an
 * absolute Location, so resolving against it hands the phone
 * `https://0.0.0.0:10000/...` — an address no browser can route.
 *
 * APP_URL is the same value the scanned code was built from in
 * lib/auth/qr-access.ts, so the redirect lands on the host the member started
 * on by construction.
 */
function absolute(path: string): URL {
  return new URL(path, `${getEnv().APP_URL.replace(/\/+$/, "")}/`);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ip = await getClientIp();
  const userAgent = await getUserAgent();

  // Keyed by address rather than by code: an attacker guessing at tokens has
  // no account to be keyed against, and rationing their attempts is the whole
  // point. The budget is generous enough that a workshop behind one connection
  // is not locked out by ordinary use.
  const limit = checkRateLimit(rateLimitKey("qr-scan", ip), RATE_LIMITS.QR_SCAN);
  if (!limit.allowed) {
    return NextResponse.redirect(absolute("/qr-invalid?reason=throttled"));
  }

  const result = await redeemQrToken(token, { ipAddress: ip, userAgent });

  if (!result.ok) {
    // One destination for every failure. Telling the holder of a card whether
    // it is unknown, expired or revoked tells a stranger whether they have
    // found a real one; the page covers all three cases in words the owner can
    // act on.
    return NextResponse.redirect(absolute("/qr-invalid"));
  }

  // A forced password change outranks the convenience this feature exists for.
  // It is set when staff issue a temporary password, and walking past it would
  // leave that password live.
  const destination = result.mustChangePassword
    ? "/account/password?required=1"
    : "/account/status?via=qr";

  const response = NextResponse.redirect(absolute(destination));

  response.cookies.set(
    SESSION_COOKIE_NAME,
    result.token,
    sessionCookieOptions(result.expiresAt)
  );

  return response;
}
