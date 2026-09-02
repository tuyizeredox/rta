import { requireApiAuth } from "@/lib/auth/guards";
import { issueQrCode, revokeQrCodes, type QrActor } from "@/lib/auth/qr-access";
import {
  apiSuccess,
  apiTooManyRequests,
  withErrorHandling,
} from "@/lib/api/response";
import {
  RATE_LIMITS,
  checkRateLimit,
  getClientIp,
  rateLimitKey,
} from "@/lib/api/rate-limit";
import type { AuthContext } from "@/lib/auth/session";

/**
 * The caller's own sign-in QR code: POST to issue or replace, DELETE to
 * revoke.
 *
 * Every role has one. An administrator arriving at a workshop with a borrowed
 * phone has the same problem a member does, and a feature that only members
 * can use is one the office cannot demonstrate.
 *
 * SCOPE IS ALWAYS "ME". Neither verb takes a user id — the session decides
 * whose code is being issued. Issuing a code on someone else's behalf would be
 * handing out a credential to their account, which is not something this
 * endpoint should make possible even for a super admin.
 *
 * The session is the authorisation. Deliberately no password re-prompt: the
 * members this exists for are the ones who cannot reliably type their password,
 * and a re-prompt would put the wall back in front of the door it removes.
 * What limits the damage from a hijacked session is that issuing is audited
 * (severity WARNING) and shows up on the owner's own security page.
 */

function actorFrom(context: AuthContext): QrActor {
  return {
    id: context.user.id,
    role: context.user.role,
    email: context.user.email,
    associationId: context.user.associationId,
  };
}

export const POST = withErrorHandling(async () => {
  const context = await requireApiAuth();
  const ip = await getClientIp();

  // Replacing a code is a rare, deliberate act. A tight budget here means a
  // script that has stolen a session cannot churn through codes faster than
  // the audit log can be read.
  const limit = checkRateLimit(
    rateLimitKey("qr-issue", ip, context.user.id),
    RATE_LIMITS.EXPORT
  );
  if (!limit.allowed) {
    return apiTooManyRequests(
      "Too many QR codes generated. Please wait a few minutes.",
      limit.retryAfter
    );
  }

  const code = await issueQrCode(context.user.id, actorFrom(context));

  // The scannable secret is NOT in this response. The page re-renders from the
  // server after this call and draws the image there, which keeps the token
  // out of the browser's JSON, out of any client-side cache and out of a
  // network log an onlooker could scroll back through.
  return apiSuccess({
    issuedAt: code.issuedAt,
    expiresAt: code.expiresAt,
  });
});

export const DELETE = withErrorHandling(async () => {
  const context = await requireApiAuth();

  const revoked = await revokeQrCodes(
    context.user.id,
    "OWNER_REVOKED",
    actorFrom(context)
  );

  return apiSuccess({ revoked });
});
