import "server-only";
import { prisma } from "@/lib/db/prisma";
import { add, subtract, toMoney, toMoneyString } from "@/lib/money";

/**
 * WHOSE MONEY IS WHOSE.
 *
 * An association running this platform is holding four kinds of money at once,
 * and the single most damaging thing it can do is treat them as one balance:
 *
 *   1. MEMBERS' SAVINGS — a liability. Every franc belongs to the member who
 *      saved it and must be returnable to them.
 *   2. THE PLATFORM'S SERVICE FEE — not the association's at all. Collected on
 *      the operator's behalf, owed to them until it is remitted. It cannot be
 *      lent, invested, or distributed.
 *   3. THE ASSOCIATION'S OWN INCOME — its half of the loan interest, plus
 *      fines, loan fees and investment returns. This is the only pot the
 *      committee may actually decide what to do with.
 *   4. THE MEMBERS' HALF OF THE INTEREST — already paid out, into the savings
 *      of the members who borrowed. It appears here so the interest a member
 *      paid and the interest they got back can be read side by side, rather
 *      than the association appearing to have earned the whole 2%.
 *
 * This module exists to compute those four separately and never to add them
 * up. There is deliberately no `grandTotal` field: any number that summed a
 * liability, a pass-through and an income would be meaningless, and somebody
 * would eventually put it on a slide.
 *
 * WHY THE SERVICE FEE IS NOT SIMPLY "FEE INCOME". Before the rulebook existed,
 * the association's income report counted every FEE debit on a savings ledger
 * as association revenue. The daily service fee is a FEE debit and is not
 * association revenue. Every fee query below therefore filters on whether the
 * ledger row has a PlatformFeeCharge attached — which is exactly why that
 * relation exists on SavingsTransaction.
 */

export interface FundSeparation {
  currency: string;

  /// Owed to members. Not the association's to spend.
  memberSavings: {
    total: string;
    savers: number;
    /// Pledged against loans or pending withdrawals.
    locked: string;
    available: string;
  };

  /// Owed to the platform operator. Not the association's at all.
  platformFee: {
    collected: string;
    remitted: string;
    owedToOperator: string;
    charges: number;
    /// Fee days a member has paid for but whose fee could not be taken,
    /// because their balance would have gone negative. Money the operator is
    /// owed that has not been collected yet.
    uncollectible: string;
    membersCharged: number;
  };

  /// The association's own money. The only pot it may decide about.
  associationIncome: {
    loanInterestShare: string;
    loanFees: string;
    loanPenalties: string;
    contributionFines: string;
    accountFees: string;
    total: string;
  };

  /// Already returned to members under the interest-sharing rule.
  memberInterest: {
    creditedFromLoans: string;
    /// Interest posted to savings for any other reason (an association that
    /// also pays a savings rate). Kept apart so the sharing rule's effect is
    /// legible on its own.
    otherInterestPaid: string;
    total: string;
  };

  /// How the fines have gone: what was raised, taken, forgiven and still owed.
  fines: {
    assessed: string;
    outstanding: string;
    settled: string;
    waived: string;
    outstandingCount: number;
  };

  /// Twelve months of the three flows that matter, for the chart. Labels are
  /// "YYYY-MM" and are formatted at render time.
  monthly: {
    label: string;
    platformFee: string;
    associationInterest: string;
    memberInterest: string;
  }[];
}

/**
 * The four pots, for one association or for the whole platform.
 *
 * Passing null gives the platform-wide figures a super admin needs — chiefly
 * "what is every association together holding of ours", which is the operator's
 * own revenue question and has no per-tenant answer.
 */
export async function getFundSeparation(
  associationId: string | null
): Promise<FundSeparation> {
  const scope = associationId ? { associationId } : {};

  const [
    association,
    savings,
    savers,
    feesCollected,
    feesRemitted,
    membersCharged,
    interest,
    otherInterest,
    accountFees,
    loanIncome,
    fineTotals,
    finesOutstanding,
    monthly,
  ] = await Promise.all([
    associationId
      ? prisma.association.findUnique({
          where: { id: associationId },
          select: { currency: true },
        })
      : Promise.resolve(null),

    prisma.savingsAccount.aggregate({
      where: { ...scope, isActive: true },
      _sum: { balance: true, lockedBalance: true },
    }),

    prisma.member.count({
      where: {
        ...scope,
        savingsAccounts: { some: { isActive: true, balance: { gt: 0 } } },
      },
    }),

    prisma.platformFeeCharge.aggregate({
      where: { ...scope, status: "CHARGED" },
      _sum: { amount: true },
      _count: true,
    }),

    prisma.platformFeeCharge.aggregate({
      where: { ...scope, status: "CHARGED", remittedAt: { not: null } },
      _sum: { amount: true },
    }),

    prisma.platformFeeCharge
      .groupBy({
        by: ["memberId"],
        where: { ...scope, status: "CHARGED" },
      })
      .then((rows) => rows.length),

    // The whole point of the InterestDistribution table: one query answers
    // both "what did the association earn" and "what went back to members",
    // and the two provably sum to what was collected.
    prisma.interestDistribution.aggregate({
      where: scope,
      _sum: { associationShare: true, memberShare: true, interestCollected: true },
    }),

    // Interest credited to savings that did NOT come from the sharing rule.
    prisma.savingsTransaction.aggregate({
      where: {
        ...scope,
        type: "INTEREST",
        direction: "CREDIT",
        status: "COMPLETED",
        interestDistribution: null,
      },
      _sum: { amount: true },
    }),

    // Account fees the ASSOCIATION charged — withdrawal fees and the like.
    // Explicitly excluding rows that carry a platform fee charge, which is the
    // operator's money and is reported in its own section above.
    prisma.savingsTransaction.aggregate({
      where: {
        ...scope,
        type: "FEE",
        direction: "DEBIT",
        status: "COMPLETED",
        platformFeeCharge: null,
      },
      _sum: { amount: true },
    }),

    prisma.loanTransaction.aggregate({
      where: { ...scope, type: "REPAYMENT", status: "COMPLETED" },
      _sum: { feesPortion: true, penaltyPortion: true },
    }),

    prisma.contributionFine.groupBy({
      by: ["status"],
      where: scope,
      _sum: { amount: true },
      _count: true,
    }),

    prisma.contributionFine.count({
      where: { ...scope, status: "OUTSTANDING" },
    }),

    monthlyFlows(associationId),
  ]);

  const fineByStatus = (status: string): string => {
    const row = fineTotals.find((entry) => entry.status === status);
    return toMoneyString(row?._sum.amount ?? 0);
  };

  const collected = toMoney(feesCollected._sum.amount ?? 0);
  const remitted = toMoney(feesRemitted._sum.amount ?? 0);

  const loanInterestShare = toMoney(interest._sum.associationShare ?? 0);
  const loanFees = toMoney(loanIncome._sum.feesPortion ?? 0);
  const loanPenalties = toMoney(loanIncome._sum.penaltyPortion ?? 0);
  const fines = toMoney(fineByStatus("SETTLED"));
  const fees = toMoney(accountFees._sum.amount ?? 0);

  const memberFromLoans = toMoney(interest._sum.memberShare ?? 0);
  const memberOther = toMoney(otherInterest._sum.amount ?? 0);

  const balance = toMoney(savings._sum.balance ?? 0);
  const locked = toMoney(savings._sum.lockedBalance ?? 0);

  return {
    currency: association?.currency ?? "RWF",

    memberSavings: {
      total: toMoneyString(balance),
      savers,
      locked: toMoneyString(locked),
      available: toMoneyString(subtract(balance, locked)),
    },

    platformFee: {
      collected: toMoneyString(collected),
      remitted: toMoneyString(remitted),
      owedToOperator: toMoneyString(subtract(collected, remitted)),
      charges: feesCollected._count,
      // Computed by the compliance screen, which knows each member's covered
      // days. Reported as zero here rather than guessed: this module counts
      // what was collected, and inventing an accrual would be exactly the kind
      // of estimate the association-finances module refuses to make.
      uncollectible: "0.00",
      membersCharged,
    },

    associationIncome: {
      loanInterestShare: toMoneyString(loanInterestShare),
      loanFees: toMoneyString(loanFees),
      loanPenalties: toMoneyString(loanPenalties),
      contributionFines: toMoneyString(fines),
      accountFees: toMoneyString(fees),
      total: toMoneyString(
        add(loanInterestShare, loanFees, loanPenalties, fines, fees)
      ),
    },

    memberInterest: {
      creditedFromLoans: toMoneyString(memberFromLoans),
      otherInterestPaid: toMoneyString(memberOther),
      total: toMoneyString(add(memberFromLoans, memberOther)),
    },

    fines: {
      assessed: toMoneyString(
        fineTotals.reduce((total, row) => add(total, row._sum.amount ?? 0), toMoney(0))
      ),
      outstanding: fineByStatus("OUTSTANDING"),
      settled: fineByStatus("SETTLED"),
      waived: fineByStatus("WAIVED"),
      outstandingCount: finesOutstanding,
    },

    monthly,
  };
}

/**
 * Twelve months of service fee, association interest and member interest.
 *
 * Raw SQL because the three come from two tables and the alternative is three
 * round trips plus a join in JavaScript. `date_trunc` in Postgres uses the
 * database's timezone, which is the same one the association operates in.
 */
async function monthlyFlows(
  associationId: string | null
): Promise<FundSeparation["monthly"]> {
  const rows = await prisma.$queryRaw<
    { month: string; platform_fee: string; association: string; member: string }[]
  >`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', now()) - interval '11 months',
        date_trunc('month', now()),
        interval '1 month'
      ) AS month
    ),
    fees AS (
      SELECT date_trunc('month', "chargedAt") AS month, SUM(amount) AS total
      FROM platform_fee_charges
      WHERE status = 'CHARGED'
        AND ("associationId" = ${associationId} OR ${associationId}::text IS NULL)
        AND "chargedAt" >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1
    ),
    interest AS (
      SELECT date_trunc('month', "createdAt") AS month,
             SUM("associationShare") AS association,
             SUM("memberShare")      AS member
      FROM interest_distributions
      WHERE ("associationId" = ${associationId} OR ${associationId}::text IS NULL)
        AND "createdAt" >= date_trunc('month', now()) - interval '11 months'
      GROUP BY 1
    )
    SELECT to_char(months.month, 'YYYY-MM')        AS month,
           COALESCE(fees.total, 0)::text           AS platform_fee,
           COALESCE(interest.association, 0)::text AS association,
           COALESCE(interest.member, 0)::text      AS member
    FROM months
    LEFT JOIN fees     ON fees.month = months.month
    LEFT JOIN interest ON interest.month = months.month
    ORDER BY months.month ASC
  `;

  return rows.map((row) => ({
    label: row.month,
    platformFee: toMoneyString(row.platform_fee),
    associationInterest: toMoneyString(row.association),
    memberInterest: toMoneyString(row.member),
  }));
}

/**
 * Marks collected service fees as paid over to the platform operator.
 *
 * Takes the charges as they stood at a moment rather than "everything
 * outstanding now", so a remittance recorded while the fee job is running
 * cannot sweep in charges raised after the payment was actually made.
 */
export async function remitPlatformFees(params: {
  associationId: string;
  upTo: Date;
  actorId: string;
}): Promise<{ count: number; amount: string }> {
  const pending = await prisma.platformFeeCharge.aggregate({
    where: {
      associationId: params.associationId,
      status: "CHARGED",
      remittedAt: null,
      chargedAt: { lte: params.upTo },
    },
    _sum: { amount: true },
    _count: true,
  });

  if (pending._count === 0) return { count: 0, amount: "0.00" };

  await prisma.platformFeeCharge.updateMany({
    where: {
      associationId: params.associationId,
      status: "CHARGED",
      remittedAt: null,
      chargedAt: { lte: params.upTo },
    },
    data: { remittedAt: new Date() },
  });

  return {
    count: pending._count,
    amount: toMoneyString(pending._sum.amount ?? 0),
  };
}
