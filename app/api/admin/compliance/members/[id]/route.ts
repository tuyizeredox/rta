import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  ContributionError,
  getMemberStanding,
  setExemption,
  setObligationStart,
} from "@/lib/services/contributions";
import { exemptionSchema, obligationStartSchema } from "@/lib/validation/rules";
import { prisma } from "@/lib/db/prisma";
import {
  apiBadRequest,
  apiNotFound,
  apiSuccess,
  withErrorHandling,
} from "@/lib/api/response";

/**
 * GET   /api/admin/compliance/members/[id] — one member's standing in full.
 * PATCH /api/admin/compliance/members/[id] — excuse them, or move the day
 *                                            their obligation began.
 *
 * Both writes take a mandatory reason. Excusing somebody from contributing and
 * redating when they started are the two ways an officer can make arrears
 * disappear without any money moving, which is exactly why neither may be done
 * without a record of who decided it and why.
 */

type Params = { params: Promise<{ id: string }> };

/** The member must belong to the caller's association. Checked, never assumed. */
async function assertInScope(memberId: string, associationId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, associationId },
    select: { id: true },
  });
  return member !== null;
}

export const GET = withErrorHandling(async (_request: NextRequest, { params }: Params) => {
  const context = await requireApiPermission(PERMISSIONS.COMPLIANCE_VIEW);
  const associationId = resolveAssociationScope(context);
  if (!associationId) return apiBadRequest("Choose an association first");

  const { id } = await params;
  if (!(await assertInScope(id, associationId))) return apiNotFound("Member not found");

  const standing = await getMemberStanding(id);
  if (!standing) return apiNotFound("Member not found");

  return apiSuccess(standing);
});

export const PATCH = withErrorHandling(async (request: NextRequest, { params }: Params) => {
  const context = await requireApiPermission(PERMISSIONS.COMPLIANCE_ACT);
  const associationId = resolveAssociationScope(context);
  if (!associationId) return apiBadRequest("Choose an association first");

  const { id } = await params;
  if (!(await assertInScope(id, associationId))) return apiNotFound("Member not found");

  const body = await request.json().catch(() => null);

  // Two shapes on one route, discriminated by which fields arrived. An
  // exemption and a change of start date are edited from the same panel and
  // saved by the same button, so splitting them across two routes would only
  // move the branch into the client.
  if (body && typeof body === "object" && "startDate" in body) {
    const parsed = obligationStartSchema.safeParse(body);
    if (!parsed.success) {
      return apiBadRequest(
        parsed.error.issues[0]?.message ?? "Please correct the highlighted fields"
      );
    }

    try {
      await setObligationStart({
        associationId,
        memberId: id,
        actorId: context.user.id,
        startDate: parsed.data.startDate,
        reason: parsed.data.reason,
      });
    } catch (error) {
      if (error instanceof ContributionError) return apiBadRequest(error.message);
      throw error;
    }

    return apiSuccess(await getMemberStanding(id));
  }

  const parsed = exemptionSchema.safeParse(body);
  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  try {
    await setExemption({
      associationId,
      memberId: id,
      actorId: context.user.id,
      isExempt: parsed.data.isExempt,
      reason: parsed.data.reason,
      until: parsed.data.until ?? null,
    });
  } catch (error) {
    if (error instanceof ContributionError) return apiBadRequest(error.message);
    throw error;
  }

  return apiSuccess(await getMemberStanding(id));
});
