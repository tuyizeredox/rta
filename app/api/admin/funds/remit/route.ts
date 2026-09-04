import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { remitPlatformFees } from "@/lib/services/funds";
import { remitFeesSchema } from "@/lib/validation/rules";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { apiBadRequest, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/funds/remit — record that collected service fees have been
 * paid over to the platform operator.
 *
 * This does not move money. It records that money already moved, outside this
 * system, by whatever means the association pays its operator. What it changes
 * is the association's own books: fees marked remitted stop counting as a
 * liability, and the "not yet deployed" figure on the members' page rises to
 * match, because that cash genuinely is the association's to use again.
 *
 * Behind PLATFORM_FEES_REMIT, which the default admin role does not hold —
 * asserting that a payment was made is a different act from seeing that one is
 * owed, and it should belong to whoever actually makes it.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiPermission(PERMISSIONS.PLATFORM_FEES_REMIT);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    return apiBadRequest("Choose an association before recording a remittance");
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `fee-remit:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const body = await request.json().catch(() => null);
  const parsed = remitFeesSchema.safeParse(body ?? {});

  if (!parsed.success) {
    return apiBadRequest(
      parsed.error.issues[0]?.message ?? "Please correct the highlighted fields"
    );
  }

  const result = await remitPlatformFees({
    associationId,
    upTo: parsed.data.upTo,
    actorId: context.user.id,
  });

  if (result.count === 0) {
    return apiBadRequest("There are no unremitted service fees up to that date");
  }

  await recordAudit(
    {
      action: AUDIT_ACTIONS.PLATFORM_FEE_REMITTED,
      entityType: "PlatformFeeCharge",
      associationId,
      newValue: {
        charges: result.count,
        amount: result.amount,
        upTo: parsed.data.upTo,
        reference: parsed.data.reference ?? null,
      },
      severity: "NOTICE",
    },
    context
  );

  return apiSuccess(result);
});
