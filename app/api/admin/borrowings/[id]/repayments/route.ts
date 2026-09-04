import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission, assertSameAssociation } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  BorrowingError,
  recordBorrowingRepayment,
} from "@/lib/services/borrowings";
import { recordRepaymentSchema } from "@/lib/validation/association-finances";
import {
  apiBadRequest,
  apiConflict,
  apiCreated,
  apiNotFound,
  withErrorHandling,
} from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * POST /api/admin/borrowings/[id]/repayments
 *
 * Posts a repayment the association made to its lender. Append-only: there is
 * no PATCH or DELETE counterpart, and there will not be one. A repayment
 * entered in error is corrected by a contra entry, so that both the mistake
 * and its correction remain visible to the members reading the facility.
 */
export const POST = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const context = await requireApiPermission(PERMISSIONS.BORROWINGS_MANAGE);

    const ip = await getClientIp();
    const limit = checkRateLimit(
      `borrowing-repayment:${context.user.id}:${ip}`,
      RATE_LIMITS.FINANCIAL_WRITE
    );
    if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

    const body = await request.json().catch(() => null);
    const parsed = recordRepaymentSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
      }
      return apiBadRequest("Please correct the highlighted fields", details);
    }

    const facility = await prisma.institutionalLoan.findUnique({
      where: { id },
      select: { id: true, associationId: true },
    });

    if (!facility) return apiNotFound("Facility not found");
    assertSameAssociation(context, facility, "InstitutionalLoan");

    try {
      const result = await recordBorrowingRepayment({
        borrowingId: id,
        actorId: context.user.id,
        amount: parsed.data.amount,
        interestPortion: parsed.data.interestPortion ?? null,
        feesPortion: parsed.data.feesPortion ?? null,
        channel: parsed.data.channel,
        description: parsed.data.description ?? null,
        externalReference: parsed.data.externalReference ?? null,
        paidAt: parsed.data.paidAt,
        nextPaymentDue: parsed.data.nextPaymentDue ?? null,
      });

      return apiCreated(result);
    } catch (error) {
      if (error instanceof BorrowingError) {
        // OVERPAYMENT and INVALID_ALLOCATION are the administrator mistyping a
        // figure from a bank advice note, not a conflict with another writer —
        // they belong in the form beside the amount field.
        if (error.code === "OVERPAYMENT" || error.code === "INVALID_ALLOCATION") {
          return apiBadRequest(error.message, { amount: [error.message] });
        }
        return error.code === "NOT_FOUND"
          ? apiNotFound(error.message)
          : apiConflict(error.message, error.code);
      }
      throw error;
    }
  }
);
