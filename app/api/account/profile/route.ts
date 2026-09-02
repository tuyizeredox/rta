import { type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { updateOwnProfile } from "@/lib/services/profile";
import {
  updateOwnAccountSchema,
  updateOwnProfileSchema,
} from "@/lib/validation/profile";
import { apiBadRequest, apiSuccess, withErrorHandling } from "@/lib/api/response";

/**
 * PUT /api/account/profile — a person edits their own details.
 *
 * SCOPE IS ALWAYS "ME". No user or member id is accepted; the session decides
 * whose record is written. So this cannot edit a colleague's file and cannot
 * reach another tenant — the isolation is structural rather than checked, and
 * there is no id to get wrong.
 *
 * `requireApiAuth` rather than a permission or a role, because everyone with a
 * sign-in has details of their own to correct. A member updates the file the
 * association holds on them; an administrator with no savings of their own
 * still has a name and a phone number, and those live on the user row.
 *
 * The schema follows from that. Someone with a member record is validated
 * against the whole file; someone without one is validated against the four
 * user fields alone, so a member field sent by a caller who has no member
 * record is dropped by the parse rather than reaching the service — there is
 * no member row for it to be written to, and the narrower schema is what says
 * so rather than a check the service would have to remember to make.
 *
 * Editing a member's OWN file here is not the same power an administrator
 * holds over everyone's — see lib/services/profile.ts for what self-service
 * deliberately cannot touch (membership status, member number, payment
 * reference, and a national ID that KYC has already verified).
 */
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiAuth();

  const body = await request.json().catch(() => null);

  const parsed = context.member
    ? updateOwnProfileSchema.safeParse(body)
    : updateOwnAccountSchema.safeParse(body);

  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  const result = await updateOwnProfile({
    userId: context.user.id,
    input: parsed.data,
  });

  if (!result.ok) {
    return apiBadRequest(result.message, { [result.field]: [result.message] });
  }

  return apiSuccess({ changed: result.changed });
});
