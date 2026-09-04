import "server-only";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { notify, NOTIFICATION_EVENTS } from "@/lib/notifications";

/**
 * TELLING THE MEMBERSHIP THAT A RULE CHANGED.
 *
 * A rulebook nobody is told about is a rulebook that changes behind people's
 * backs. When a committee raises the fine rate or shortens the loan term, the
 * members it applies to find out either now, or when they are first caught by
 * it — and the second is how an association loses the room.
 *
 * IN-APP ONLY, DELIBERATELY. A rule change is important but not urgent: it
 * belongs in the notification list a member sees next time they open the app,
 * not as an SMS at eleven at night that costs the association money per
 * recipient. The urgent messages — you are about to be fined, a fine has been
 * added — go by SMS, and keeping this one quiet is what stops those from being
 * ignored.
 *
 * Failures are logged and swallowed. A messaging problem must never roll back
 * a rule amendment that has already been committed and audited; the change is
 * on the rules page either way, which is the record that matters.
 */
export async function notifyMembersOfRuleChange(params: {
  associationId: string;
  ruleTitle: string;
  reason: string;
}): Promise<{ notified: number }> {
  try {
    const members = await prisma.member.findMany({
      where: {
        associationId: params.associationId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
        user: { status: "ACTIVE" },
      },
      select: { userId: true },
      // A cap rather than an unbounded fan-out. An association large enough to
      // exceed this has a general meeting for the purpose, and the rules page
      // carries the change for everyone regardless.
      take: 5000,
    });

    for (const member of members) {
      await notify({
        userId: member.userId,
        event: NOTIFICATION_EVENTS.RULE_CHANGED,
        context: { ruleTitle: params.ruleTitle, reason: params.reason },
        channels: ["IN_APP"],
        entityType: "AssociationRule",
      });
    }

    return { notified: members.length };
  } catch (error) {
    logger.error(
      { err: error, associationId: params.associationId },
      "failed to announce rule change"
    );
    return { notified: 0 };
  }
}
