import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireApiPermission, assertSameAssociation } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { BorrowingError, updateBorrowing } from "@/lib/services/borrowings";
import { updateBorrowingSchema } from "@/lib/validation/association-finances";
import {
  apiBadRequest,
  apiConflict,
  apiNotFound,
  apiSuccess,
  withErrorHandling,
} from "@/lib/api/response";

/**
 * PATCH /api/admin/borrowings/[id]
 *
 * Edits the descriptive and lifecycle fields of a facility. The amounts are
 * not editable — see `updateBorrowing`, which explains why.
 */
export const PATCH = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const context = await requireApiPermission(PERMISSIONS.BORROWINGS_MANAGE);

    const body = await request.json().catch(() => null);
    const parsed = updateBorrowingSchema.safeParse(body);

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
      await updateBorrowing({
        id,
        actorId: context.user.id,
        ...parsed.data,
      });
    } catch (error) {
      if (error instanceof BorrowingError) {
        return error.code === "NOT_FOUND"
          ? apiNotFound(error.message)
          : apiConflict(error.message, error.code);
      }
      throw error;
    }

    return apiSuccess({ id });
  }
);
