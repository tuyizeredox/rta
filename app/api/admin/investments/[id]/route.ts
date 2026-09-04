import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission, assertSameAssociation } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { InvestmentError, updateInvestment } from "@/lib/services/investments";
import { updateInvestmentSchema } from "@/lib/validation/association-finances";
import {
  apiBadRequest,
  apiNotFound,
  apiSuccess,
  withErrorHandling,
} from "@/lib/api/response";

/**
 * PATCH /api/admin/investments/[id]
 *
 * Updates a recorded investment — most often to raise `amountReturned` as a
 * project starts paying for itself, or to fill in the benefit sentence once
 * there is something real to say.
 */
export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const context = await requireApiPermission(PERMISSIONS.INVESTMENTS_MANAGE);

    const body = await request.json().catch(() => null);
    const parsed = updateInvestmentSchema.safeParse(body);

    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
      }
      return apiBadRequest("Please correct the highlighted fields", details);
    }

    const investment = await prisma.associationInvestment.findUnique({
      where: { id },
      select: { id: true, associationId: true },
    });

    if (!investment) return apiNotFound("Investment not found");
    assertSameAssociation(context, investment, "AssociationInvestment");

    const input = parsed.data;

    try {
      await updateInvestment({
        id,
        actorId: context.user.id,
        title: input.title,
        category: input.category,
        status: input.status,
        summary: input.summary,
        description: input.description,
        benefitSummary: input.benefitSummary,
        membersBenefited:
          typeof input.membersBenefited === "number" ? input.membersBenefited : undefined,
        fundingSource: input.fundingSource,
        fundedByLoanId: input.fundedByLoanId,
        amountInvested: input.amountInvested,
        amountReturned: input.amountReturned,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        isPublic: input.isPublic,
      });
    } catch (error) {
      if (error instanceof InvestmentError) {
        return error.code === "NOT_FOUND"
          ? apiNotFound(error.message)
          : apiBadRequest(error.message, { fundedByLoanId: [error.message] });
      }
      throw error;
    }

    return apiSuccess({ id });
  }
);
