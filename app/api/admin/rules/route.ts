import { type NextRequest } from "next/server";
import { requireApiPermission, resolveAssociationScope } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  createCustomRule,
  ensureRulebook,
  listRules,
  RuleError,
} from "@/lib/services/rulebook";
import { createRuleSchema } from "@/lib/validation/rules";
import { notifyMembersOfRuleChange } from "@/lib/services/rule-announcements";
import {
  apiBadRequest,
  apiCreated,
  apiSuccess,
  withErrorHandling,
} from "@/lib/api/response";
import { RATE_LIMITS, checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

/**
 * GET  /api/admin/rules — the rulebook, seeded if it has never been opened.
 * POST /api/admin/rules — add a rule the committee wrote.
 *
 * A custom rule is always informational: nothing in the code reads it. That is
 * enforced in the service rather than trusted from the request body, because a
 * rule that a member believed was enforced and was not would be worse than no
 * rule at all.
 */

export const GET = withErrorHandling(async () => {
  const context = await requireApiPermission(PERMISSIONS.RULES_MANAGE);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    return apiBadRequest("Choose an association before opening its rulebook");
  }

  await ensureRulebook(associationId, context.user.id);
  const rules = await listRules(associationId, { includeInactive: true });

  return apiSuccess({ rules });
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const context = await requireApiPermission(PERMISSIONS.RULES_MANAGE);
  const associationId = resolveAssociationScope(context);

  if (!associationId) {
    return apiBadRequest("Choose an association before adding a rule");
  }

  const ip = await getClientIp();
  const limit = checkRateLimit(
    `rule-create:${context.user.id}:${ip}`,
    RATE_LIMITS.FINANCIAL_WRITE
  );
  if (!limit.allowed) return apiBadRequest("Too many requests. Please slow down.");

  const body = await request.json().catch(() => null);
  const parsed = createRuleSchema.safeParse(body);

  if (!parsed.success) {
    const details: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (details[issue.path.join(".") || "_"] ??= []).push(issue.message);
    }
    return apiBadRequest("Please correct the highlighted fields", details);
  }

  const input = parsed.data;

  try {
    const created = await createCustomRule({
      associationId,
      actorId: context.user.id,
      category: input.category,
      valueType: input.valueType,
      value: input.value ?? null,
      titleEn: input.titleEn,
      titleRw: input.titleRw,
      bodyEn: input.bodyEn,
      bodyRw: input.bodyRw,
    });

    if (input.notifyMembers) {
      await notifyMembersOfRuleChange({
        associationId,
        ruleTitle: input.titleEn,
        reason: "A new rule has been added to the association's rulebook.",
      });
    }

    return apiCreated(created);
  } catch (error) {
    if (error instanceof RuleError) return apiBadRequest(error.message);
    throw error;
  }
});
