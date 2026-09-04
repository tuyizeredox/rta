import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { InvestmentError, recordInvestment } from "@/lib/services/investments";
import { createInvestmentSchema } from "@/lib/validation/association-finances";
import {
  apiBadRequest,
  apiCreated,
  withErrorHandling,
} from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/investments
 *
 * Records something the association put members' money into.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiPermission(PERMISSIONS.INVESTMENTS_MANAGE);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    return apiBadRequest("Choose an association before recording an investment");
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `investment-create:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const body = await request.json().catch(() => null);
  const parsed = createInvestmentSchema.safeParse(body);

  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  const input = parsed.data;

  try {
    const created = await recordInvestment({
      associationId,
      actorId: context.user.id,
      title: input.title,
      category: input.category,
      status: input.status,
      summary: input.summary,
      description: input.description ?? null,
      benefitSummary: input.benefitSummary ?? null,
      membersBenefited:
        typeof input.membersBenefited === "number" ? input.membersBenefited : null,
      fundingSource: input.fundingSource,
      fundedByLoanId: input.fundedByLoanId ?? null,
      amountInvested: input.amountInvested,
      amountReturned: input.amountReturned ?? null,
      currency: context.association?.currency ?? "RWF",
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      isPublic: input.isPublic,
    });

    return apiCreated(created);
  } catch (error) {
    if (error instanceof InvestmentError) {
      return apiBadRequest(error.message, { fundedByLoanId: [error.message] });
    }
    throw error;
  }
});
