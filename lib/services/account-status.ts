import "server-only";
import { prisma } from "@/lib/db/prisma";
import { add, subtract, toMoneyString } from "@/lib/money";
import { availableBalance } from "@/lib/services/ledger";
import type { MemberStatus, KycStatus } from "@/lib/generated/prisma/enums";

/**
 * The short answer to "how does my account stand".
 *
 * Deliberately narrower than `getMemberDashboard`: this is what someone sees
 * within a second of scanning their card, so it asks the database for the four
 * things that decide whether they need to do anything today — is my membership
 * live, what have I saved, what do I owe, and when is it due — and nothing
 * that would be drawn as a chart.
 *
 * Returns null for a staff account, which has no member record and therefore
 * no savings of its own. The page renders a different panel in that case
 * rather than a row of zeroes.
 */

export interface AccountStatusSummary {
  memberNumber: string;
  paymentReference: string;
  status: MemberStatus;
  kycStatus: KycStatus;
  joinedAt: Date | null;
  /// Null when a member has been approved but no savings account exists yet —
  /// a real state during onboarding, and one the page must not show as zero.
  savings: {
    balance: string;
    available: string;
    currency: string;
  } | null;
  loan: {
    outstanding: string;
    daysOverdue: number;
    reference: string;
    nextInstalment: { amount: string; dueDate: Date } | null;
  } | null;
}

export async function getAccountStatusSummary(
  memberId: string
): Promise<AccountStatusSummary | null> {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      memberNumber: true,
      paymentReference: true,
      status: true,
      kycStatus: true,
      joinedAt: true,
      approvedAt: true,
      savingsAccounts: {
        where: { isActive: true },
        orderBy: { openedAt: "asc" },
        take: 1,
        select: { balance: true, lockedBalance: true, currency: true },
      },
    },
  });

  if (!member) return null;

  const activeLoan = await prisma.loan.findFirst({
    where: {
      memberId,
      status: { in: ["DISBURSED", "ACTIVE", "OVERDUE"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      reference: true,
      principalOutstanding: true,
      interestOutstanding: true,
      feesOutstanding: true,
      penaltyOutstanding: true,
      daysOverdue: true,
      installments: {
        where: { status: { in: ["UPCOMING", "DUE", "PARTIALLY_PAID", "OVERDUE"] } },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { totalDue: true, totalPaid: true, dueDate: true },
      },
    },
  });

  const account = member.savingsAccounts[0] ?? null;
  const nextInstalment = activeLoan?.installments[0] ?? null;

  return {
    memberNumber: member.memberNumber,
    paymentReference: member.paymentReference,
    status: member.status,
    kycStatus: member.kycStatus,
    // `joinedAt` is when they started; `approvedAt` is when the association
    // agreed. Members recruited at a meeting often have only the second.
    joinedAt: member.joinedAt ?? member.approvedAt,
    savings: account
      ? {
          balance: account.balance.toFixed(2),
          available: availableBalance(account.balance, account.lockedBalance),
          currency: account.currency,
        }
      : null,
    loan: activeLoan
      ? {
          // Outstanding is every component a member still owes, not principal
          // alone — quoting the smaller number here is how a "settled" loan
          // turns out to have penalties left on it.
          outstanding: toMoneyString(
            add(
              activeLoan.principalOutstanding,
              activeLoan.interestOutstanding,
              activeLoan.feesOutstanding,
              activeLoan.penaltyOutstanding
            )
          ),
          daysOverdue: activeLoan.daysOverdue,
          reference: activeLoan.reference,
          nextInstalment: nextInstalment
            ? {
                amount: toMoneyString(
                  subtract(nextInstalment.totalDue, nextInstalment.totalPaid)
                ),
                dueDate: nextInstalment.dueDate,
              }
            : null,
        }
      : null,
  };
}
