import "server-only";
import type { TxClient } from "@/lib/db/prisma";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { gt, isPositive, subtract, toMoney, toMoneyString } from "@/lib/money";
import { postSavingsTransaction } from "@/lib/services/ledger";
import { memberInterestShare, type AssociationPolicy } from "@/lib/services/rulebook";

/**
 * DIVIDING THE INTEREST A BORROWER PAYS.
 *
 * The association's lending rule is 2% a month, of which one point goes back
 * into the borrower's own savings and one point stays with the association.
 * A member repaying a loan is therefore paying half the interest to themselves.
 *
 * That is an unusual arrangement and it is the reason this module exists rather
 * than a line inside the repayment function. Three things have to be true of it
 * every single time, and each is easy to get wrong in passing:
 *
 *  1. THE TWO HALVES MUST SUM TO THE WHOLE. The association's share is worked
 *     out by SUBTRACTION, never by a second percentage. Two independent
 *     roundings of 833.335 both land on 833.34 and invent a cent that nobody
 *     paid; taking one and subtracting guarantees the pair reconstruct the
 *     interest exactly, whatever the ratio.
 *
 *  2. THE MEMBER'S HALF MUST ACTUALLY ARRIVE. It is posted to their savings
 *     ledger inside the same transaction as the repayment. A promise credited
 *     "later" by a nightly job is a promise that breaks the first time the job
 *     fails, and the member has no way of knowing it did.
 *
 *  3. IT MUST BE PROVABLE AFTERWARDS. The InterestDistribution row records what
 *     was collected, how it was split, and the rate in force at the time — so
 *     an association that later changes the split cannot make last year's
 *     distributions unexplainable, and a member can be shown the arithmetic.
 */

export interface InterestSplit {
  interestCollected: string;
  memberShare: string;
  associationShare: string;
  memberRate: string;
  associationRate: string;
}

/**
 * Splits collected interest per the rulebook. Pure — no database, no ledger.
 *
 * A policy that gives the member nothing (both points at zero, or the member's
 * point set to zero) yields a member share of zero and the whole amount to the
 * association. That is a legitimate configuration for an association that does
 * not share interest, and it must not divide by zero on the way there.
 */
export function splitInterest(
  policy: AssociationPolicy,
  interestCollected: string
): InterestSplit {
  const collected = toMoney(interestCollected);

  const memberShare = collected.times(memberInterestShare(policy));
  const memberQuantized = toMoneyString(memberShare);

  return {
    interestCollected: toMoneyString(collected),
    memberShare: memberQuantized,
    // By subtraction. See rule 1 above.
    associationShare: toMoneyString(subtract(collected, memberQuantized)),
    memberRate: policy.interestMemberPoints,
    associationRate: policy.interestAssociationPoints,
  };
}

export interface DistributeInterestInput {
  policy: AssociationPolicy;
  associationId: string;
  loanId: string;
  memberId: string;
  loanTransactionId: string;
  /// The member's active savings account. Null when they have none, in which
  /// case the split is recorded but the credit is left for an officer.
  savingsAccountId: string | null;
  interestCollected: string;
  loanReference: string;
  currency: string;
  actorId?: string | null;
}

export interface DistributionResult {
  memberShare: string;
  associationShare: string;
  /// The balance the member's savings reached after their share landed, for
  /// the notification. Null when nothing was credited.
  balanceAfter: string | null;
}

/**
 * Credits the borrower's share and records how the interest was divided.
 *
 * MUST be called inside the repayment's own transaction — the whole point is
 * that the member's share cannot be lost while the repayment survives.
 *
 * Returns null when there is nothing to divide, so the caller can skip the
 * notification rather than telling a member about a credit of zero.
 */
export async function distributeInterest(
  tx: TxClient,
  input: DistributeInterestInput
): Promise<DistributionResult | null> {
  if (!isPositive(input.interestCollected)) return null;

  const split = splitInterest(input.policy, input.interestCollected);

  let savingsTransactionId: string | null = null;
  let balanceAfter: string | null = null;

  if (gt(split.memberShare, 0) && input.savingsAccountId) {
    const posted = await postSavingsTransaction(
      {
        savingsAccountId: input.savingsAccountId,
        type: "INTEREST",
        direction: "CREDIT",
        amount: split.memberShare,
        description: `Your share of the interest on loan ${input.loanReference}`,
        loanId: input.loanId,
        loanTransactionId: input.loanTransactionId,
        postedById: input.actorId ?? null,
      },
      tx
    );

    savingsTransactionId = posted.id;
    balanceAfter = posted.balanceAfter;
  }

  await tx.interestDistribution.create({
    data: {
      associationId: input.associationId,
      loanId: input.loanId,
      memberId: input.memberId,
      loanTransactionId: input.loanTransactionId,
      interestCollected: split.interestCollected,
      memberShare: split.memberShare,
      associationShare: split.associationShare,
      memberRate: split.memberRate,
      associationRate: split.associationRate,
      currency: input.currency,
      savingsTransactionId,
    },
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.INTEREST_DISTRIBUTED,
      entityType: "InterestDistribution",
      entityId: input.loanTransactionId,
      associationId: input.associationId,
      newValue: {
        loanReference: input.loanReference,
        interestCollected: split.interestCollected,
        memberShare: split.memberShare,
        associationShare: split.associationShare,
      },
      metadata: {
        memberId: input.memberId,
        credited: savingsTransactionId !== null,
      },
    },
    input.actorId ? { id: input.actorId } : null,
    tx
  );

  return {
    memberShare: split.memberShare,
    associationShare: split.associationShare,
    balanceAfter,
  };
}

/**
 * What a member has earned back from their own borrowing, all time.
 *
 * Shown on the member's loan page beside what they paid, because "you have
 * paid 24,000 in interest" and "12,000 of it came back to you" are two halves
 * of the same fact and showing only the first misrepresents the arrangement.
 */
export async function memberInterestEarned(
  tx: TxClient,
  memberId: string
): Promise<{ credited: string; paid: string }> {
  const totals = await tx.interestDistribution.aggregate({
    where: { memberId },
    _sum: { memberShare: true, interestCollected: true },
  });

  return {
    credited: toMoneyString(totals._sum.memberShare ?? 0),
    paid: toMoneyString(totals._sum.interestCollected ?? 0),
  };
}

