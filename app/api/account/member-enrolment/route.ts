import { requireApiPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { enrolExistingUserAsMember } from "@/lib/services/members";
import {
  apiConflict,
  apiCreated,
  apiForbidden,
  withErrorHandling,
} from "@/lib/api/response";

/**
 * POST /api/account/member-enrolment — a member of staff opens a savings
 * account of their own.
 *
 * WHY STAFF NEED THIS AT ALL. In a savings association the people running it
 * save with it: the treasurer contributes monthly and borrows like anyone
 * else. Until now the only way to record that was to enrol them as a second,
 * separate user, which splits one person's identity across two logins and
 * leaves the audit trail unable to say that the administrator who approved a
 * loan is the member who took one.
 *
 * SCOPE IS ALWAYS "ME". No user id is accepted; the session decides who is
 * being enrolled, and the association comes from their own user record. So
 * this cannot enrol a colleague, and it cannot reach another tenant.
 *
 * GATED ON `members.create`. Someone who may already enrol anyone in the
 * association may enrol themselves — that is strictly less authority than they
 * hold already. Someone who may not create members does not get to create one
 * here either; they ask a colleague, exactly as a member would.
 *
 * A pure platform super admin belongs to no association and is refused by the
 * service, with a message that says why.
 */
export const POST = withErrorHandling(async () => {
  const context = await requireApiPermission(PERMISSIONS.MEMBERS_CREATE);

  if (context.member) {
    return apiConflict(
      "This account already has a member record",
      "ALREADY_A_MEMBER"
    );
  }

  const result = await enrolExistingUserAsMember(context.user.id, context.user.id);

  if (!result.ok) {
    return apiForbidden(result.message);
  }

  return apiCreated({
    memberNumber: result.memberNumber,
    paymentReference: result.paymentReference,
  });
});
