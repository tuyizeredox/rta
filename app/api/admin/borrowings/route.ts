import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { recordBorrowing } from "@/lib/services/borrowings";
import { createBorrowingSchema } from "@/lib/validation/association-finances";
import {
  apiBadRequest,
  apiCreated,
  withErrorHandling,
} from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/borrowings
 *
 * Records a facility the association has taken from a bank.
 *
 * No ledger moves here — nothing is credited or debited to any member — but it
 * is still rate-limited as a financial write, because what it publishes is a
 * statement to every member about a debt secured on their savings, and a
 * scripted burst of those is not something an association should be able to do
 * by accident.
 */
export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiPermission(PERMISSIONS.BORROWINGS_MANAGE);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    // A super admin acting at platform scope has no association to attach the
    // facility to. They must open one first.
    return apiBadRequest("Choose an association before recording a facility");
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `borrowing-create:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const body = await request.json().catch(() => null);
  const parsed = createBorrowingSchema.safeParse(body);

  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  const input = parsed.data;

  const created = await recordBorrowing({
    associationId,
    actorId: context.user.id,
    lenderName: input.lenderName,
    lenderType: input.lenderType,
    lenderReference: input.lenderReference ?? null,
    lenderContact: input.lenderContact ?? null,
    purpose: input.purpose,
    principal: input.principal,
    interestRate: input.interestRate,
    interestMethod: input.interestMethod,
    termMonths: input.termMonths,
    currency: context.association?.currency ?? "RWF",
    totalInterest: input.totalInterest ?? null,
    totalFees: input.totalFees ?? null,
    collateralDescription: input.collateralDescription ?? null,
    collateralAmount: input.collateralAmount ?? null,
    status: input.status,
    disbursedAt: input.disbursedAt ?? null,
    firstPaymentDue: input.firstPaymentDue ?? null,
    maturityDate: input.maturityDate ?? null,
    isPublic: input.isPublic,
  });

  return apiCreated(created);
});
