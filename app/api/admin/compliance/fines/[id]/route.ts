import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ContributionError, settleFine, waiveFine } from "@/lib/services/contributions";
import { fineActionSchema } from "@/lib/validation/rules";
import { apiBadRequest, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * PATCH /api/admin/compliance/fines/[id] — collect a fine, or forgive it.
 *
 * Two actions on one route because they are the two ways a fine ends, and an
 * officer looking at an outstanding fine is choosing between them. Waiving
 * requires a written reason; collecting does not, because the rule already
 * supplies the justification and the audit entry names who pressed it.
 *
 * Collection can legitimately fail: a member whose savings do not cover the
 * fine is not overdrawn to pay it. That comes back as a plain message, not an
 * error page, because it is a normal outcome an officer needs to read.
 */

type Params = { params: Promise<{ id: string }> };

export const PATCH = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const context = await requireApiPermission(PERMISSIONS.COMPLIANCE_ACT);
  const associationId = resolveAssociationScope(context);
  if (!associationId) return apiBadRequest("Choose an association first");

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `fine-action:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = fineActionSchema.safeParse(body);

  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  try {
    if (parsed.data.action === "SETTLE") {
      const settled = await settleFine({
        associationId,
        fineId: id,
        actorId: context.user.id,
      });
      return apiSuccess(settled);
    }

    await waiveFine({
      associationId,
      fineId: id,
      actorId: context.user.id,
      reason: parsed.data.reason,
    });

    return apiSuccess({ waived: true });
  } catch (error) {
    if (error instanceof ContributionError) return apiBadRequest(error.message);
    throw error;
  }
});
