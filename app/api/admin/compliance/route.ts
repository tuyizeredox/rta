import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  assessFines,
  chargePlatformFees,
  sendContributionReminders,
} from "@/lib/services/contributions";
import { complianceRunSchema } from "@/lib/validation/rules";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { apiBadRequest, apiSuccess, withErrorHandling } from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/compliance — run the nightly contribution work by hand.
 *
 * The same three tasks the worker runs at 2am: take the service fee for
 * contribution days already paid for, assess the fines the rules call for, and
 * warn the members who are close to one.
 *
 * WHY THIS EXISTS AS A BUTTON AT ALL. The worker is a separate process, and
 * separate processes stop. An association preparing for a meeting on Friday
 * evening should not have to discover on Monday that nobody has been warned
 * since Tuesday. Every task is idempotent — the unique indexes on
 * platform_fee_charges and contribution_fines see to that — so pressing it
 * twice does nothing the first press did not already do.
 *
 * Rate-limited as a financial write: it moves money out of members' balances.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiPermission(PERMISSIONS.COMPLIANCE_ACT);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    return apiBadRequest("Choose an association before running the daily checks");
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `compliance-run:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const body = await request.json().catch(() => null);
  const parsed = complianceRunSchema.safeParse(body);

  if (!parsed.success) {
    return apiBadRequest("Choose at least one task to run");
  }

  const tasks = new Set(parsed.data.tasks);

  // Order matters. Fees first, because charging them changes nobody's arrears
  // but does change balances; fines next, on the arrears as they now stand;
  // reminders last, so a member warned tonight is warned about the position
  // after tonight's fine rather than the one before it.
  const fees = tasks.has("FEES")
    ? await chargePlatformFees(associationId, { actorId: context.user.id })
    : null;

  const fines = tasks.has("FINES")
    ? await assessFines(associationId, { actorId: context.user.id })
    : null;

  const reminders = tasks.has("REMINDERS")
    ? await sendContributionReminders(associationId)
    : null;

  await recordAudit(
    {
      action: AUDIT_ACTIONS.PLATFORM_FEE_CHARGED,
      entityType: "ComplianceRun",
      associationId,
      newValue: { tasks: [...tasks], fees, fines, reminders },
      metadata: { manual: true },
      severity: "NOTICE",
    },
    context
  );

  return apiSuccess({ fees, fines, reminders });
});
