import "server-only";
import { prisma, withFinancialTransaction, type TxClient } from "@/lib/db/prisma";
import {
  add,
  gt,
  lt,
  min,
  subtract,
  toMoney,
  toMoneyString,
  type MoneyInput,
} from "@/lib/money";
import { buildTransactionReference } from "@/lib/services/ledger";
import { generateSchedule } from "@/lib/services/loan-calculator";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import type {
  InstitutionalLoanStatus,
  InterestMethod,
  LenderType,
  PaymentChannel,
} from "@/lib/generated/prisma/enums";

/**
 * The association's OWN borrowing.
 *
 * A savings association that wants to lend more than its members have saved
 * borrows the difference from a bank, pledging the members' pooled savings as
 * security. That debt belongs on the members' screen, not only the treasurer's:
 * it is their money backing it.
 *
 * WHY THIS IS NOT `lib/services/loans.ts`. Everything in that module reduces a
 * balance a member owes the association. Everything here reduces a balance the
 * association owes a bank. The two are opposite signs on the same balance
 * sheet, and the single most damaging mistake this module can make is to let
 * them be added together — an association would report a debt as an asset and
 * tell its members it is richer than it is. Separate models, separate ledgers,
 * separate services.
 *
 * The same ledger discipline as the rest of the platform applies: repayments
 * are append-only rows, the loan's outstanding position is a cache written
 * only inside the transaction that appends one, and the row is locked before
 * it is read.
 */

export class BorrowingError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "OVERPAYMENT"
      | "INVALID_ALLOCATION"
  ) {
    super(message);
    this.name = "BorrowingError";
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface BorrowingSummary {
  id: string;
  reference: string;
  status: InstitutionalLoanStatus;
  lenderName: string;
  lenderType: LenderType;
  lenderReference: string | null;
  purpose: string;
  principal: string;
  interestRate: string;
  interestMethod: InterestMethod;
  termMonths: number;
  currency: string;
  totalInterest: string;
  totalFees: string;
  totalPayable: string;
  principalOutstanding: string;
  interestOutstanding: string;
  outstanding: string;
  principalRepaid: string;
  interestPaid: string;
  feesPaid: string;
  totalRepaid: string;
  /// 0–100. What share of the contracted total has been paid back.
  repaidPercent: number;
  collateralDescription: string | null;
  collateralAmount: string | null;
  disbursedAt: Date | null;
  nextPaymentDue: Date | null;
  maturityDate: Date | null;
  completedAt: Date | null;
  daysOverdue: number;
  overdueAmount: string;
  isPublic: boolean;
  createdAt: Date;
  /// Projects this facility paid for, so a member can follow the debt through
  /// to the thing it bought.
  fundedInvestments: { id: string; title: string; amountInvested: string }[];
}

const BORROWING_SELECT = {
  id: true,
  reference: true,
  status: true,
  lenderName: true,
  lenderType: true,
  lenderReference: true,
  purpose: true,
  principal: true,
  interestRate: true,
  interestMethod: true,
  termMonths: true,
  currency: true,
  totalInterest: true,
  totalFees: true,
  totalPayable: true,
  principalOutstanding: true,
  interestOutstanding: true,
  principalRepaid: true,
  interestPaid: true,
  feesPaid: true,
  totalRepaid: true,
  collateralDescription: true,
  collateralAmount: true,
  disbursedAt: true,
  nextPaymentDue: true,
  maturityDate: true,
  completedAt: true,
  daysOverdue: true,
  overdueAmount: true,
  isPublic: true,
  createdAt: true,
  investments: {
    select: { id: true, title: true, amountInvested: true },
    orderBy: { createdAt: "desc" },
  },
} as const;

/** Statuses where the association still owes money on the facility. */
export const LIVE_BORROWING_STATUSES = [
  "PENDING_DISBURSEMENT",
  "ACTIVE",
  "OVERDUE",
] as const satisfies readonly InstitutionalLoanStatus[];

/**
 * Every facility for an association.
 *
 * `includeUnpublished` defaults to false so that a caller which forgets to
 * think about it gets the members' view — the safe direction to fail in for a
 * screen that anyone in the association can open.
 */
export async function listBorrowings(
  associationId: string | null,
  options: { includeUnpublished?: boolean } = {}
): Promise<BorrowingSummary[]> {
  const rows = await prisma.institutionalLoan.findMany({
    where: {
      ...(associationId ? { associationId } : {}),
      ...(options.includeUnpublished ? {} : { isPublic: true }),
    },
    orderBy: [{ status: "asc" }, { disbursedAt: "desc" }, { createdAt: "desc" }],
    select: BORROWING_SELECT,
  });

  return rows.map(toBorrowingSummary);
}

export async function getBorrowing(id: string): Promise<
  | (BorrowingSummary & {
      associationId: string;
      lenderContact: string | null;
      repayments: {
        id: string;
        sequence: number;
        reference: string;
        amount: string;
        principalPortion: string;
        interestPortion: string;
        feesPortion: string;
        balanceAfter: string;
        channel: PaymentChannel;
        description: string | null;
        externalReference: string | null;
        paidAt: Date;
      }[];
    })
  | null
> {
  const row = await prisma.institutionalLoan.findUnique({
    where: { id },
    select: {
      ...BORROWING_SELECT,
      associationId: true,
      lenderContact: true,
      repayments: {
        orderBy: { sequence: "desc" },
        select: {
          id: true,
          sequence: true,
          reference: true,
          amount: true,
          principalPortion: true,
          interestPortion: true,
          feesPortion: true,
          balanceAfter: true,
          channel: true,
          description: true,
          externalReference: true,
          paidAt: true,
        },
      },
    },
  });

  if (!row) return null;

  return {
    ...toBorrowingSummary(row),
    associationId: row.associationId,
    lenderContact: row.lenderContact,
    repayments: row.repayments.map((r) => ({
      id: r.id,
      sequence: r.sequence,
      reference: r.reference,
      amount: r.amount.toFixed(2),
      principalPortion: r.principalPortion.toFixed(2),
      interestPortion: r.interestPortion.toFixed(2),
      feesPortion: r.feesPortion.toFixed(2),
      balanceAfter: r.balanceAfter.toFixed(2),
      channel: r.channel,
      description: r.description,
      externalReference: r.externalReference,
      paidAt: r.paidAt,
    })),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the shared select is
   typed by Prisma at each call site; this mapper works over the common shape. */
function toBorrowingSummary(row: any): BorrowingSummary {
  const outstanding = add(row.principalOutstanding, row.interestOutstanding);
  const payable = toMoney(row.totalPayable);

  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    lenderName: row.lenderName,
    lenderType: row.lenderType,
    lenderReference: row.lenderReference,
    purpose: row.purpose,
    principal: row.principal.toFixed(2),
    // Rates are quoted to four decimals in the column; trailing zeros on a
    // whole percentage read as spurious precision on a member's screen.
    interestRate: String(Number(row.interestRate.toFixed(4))),
    interestMethod: row.interestMethod,
    termMonths: row.termMonths,
    currency: row.currency,
    totalInterest: row.totalInterest.toFixed(2),
    totalFees: row.totalFees.toFixed(2),
    totalPayable: row.totalPayable.toFixed(2),
    principalOutstanding: row.principalOutstanding.toFixed(2),
    interestOutstanding: row.interestOutstanding.toFixed(2),
    outstanding: toMoneyString(outstanding),
    principalRepaid: row.principalRepaid.toFixed(2),
    interestPaid: row.interestPaid.toFixed(2),
    feesPaid: row.feesPaid.toFixed(2),
    totalRepaid: row.totalRepaid.toFixed(2),
    repaidPercent: payable.greaterThan(0)
      ? Math.min(
          100,
          Math.round(toMoney(row.totalRepaid).dividedBy(payable).times(100).toNumber())
        )
      : 0,
    collateralDescription: row.collateralDescription,
    collateralAmount: row.collateralAmount ? row.collateralAmount.toFixed(2) : null,
    disbursedAt: row.disbursedAt,
    nextPaymentDue: row.nextPaymentDue,
    maturityDate: row.maturityDate,
    completedAt: row.completedAt,
    daysOverdue: row.daysOverdue,
    overdueAmount: row.overdueAmount.toFixed(2),
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    fundedInvestments: (row.investments ?? []).map(
      (i: { id: string; title: string; amountInvested: { toFixed(dp: number): string } }) => ({
        id: i.id,
        title: i.title,
        amountInvested: i.amountInvested.toFixed(2),
      })
    ),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordBorrowingInput {
  associationId: string;
  actorId: string;
  lenderName: string;
  lenderType: LenderType;
  lenderReference?: string | null;
  lenderContact?: string | null;
  purpose: string;
  principal: MoneyInput;
  /// Annual percentage, e.g. 16 for 16%.
  interestRate: MoneyInput;
  interestMethod: InterestMethod;
  termMonths: number;
  currency?: string;
  /// The lender's own figure. Supplied when the offer letter states it,
  /// which is the case that matters — see `resolveCost`.
  totalInterest?: MoneyInput | null;
  totalFees?: MoneyInput | null;
  collateralDescription?: string | null;
  collateralAmount?: MoneyInput | null;
  status?: InstitutionalLoanStatus;
  disbursedAt?: Date | null;
  firstPaymentDue?: Date | null;
  maturityDate?: Date | null;
  isPublic?: boolean;
}

/**
 * Records a facility the association has taken on.
 *
 * The cost of the loan is whatever the lender actually charges, so a stated
 * `totalInterest` always wins. It is only computed when the administrator has
 * not been given one — a first estimate to show members, replaced the moment
 * the offer letter arrives. Computing over a stated figure would be the system
 * telling a bank what its own loan costs.
 */
export async function recordBorrowing(
  input: RecordBorrowingInput
): Promise<{ id: string; reference: string }> {
  const cost = resolveCost(input);
  const reference = buildTransactionReference("BRW");
  const currency = input.currency ?? "RWF";
  const status = input.status ?? (input.disbursedAt ? "ACTIVE" : "PENDING_DISBURSEMENT");

  // Nothing is owed until the money actually arrives, so an undisbursed
  // facility opens with a zero position rather than its full principal.
  const disbursed = Boolean(input.disbursedAt);

  const created = await prisma.institutionalLoan.create({
    data: {
      associationId: input.associationId,
      reference,
      status,
      lenderName: input.lenderName,
      lenderType: input.lenderType,
      lenderReference: input.lenderReference ?? null,
      lenderContact: input.lenderContact ?? null,
      purpose: input.purpose,
      principal: toMoneyString(input.principal),
      interestRate: toMoney(input.interestRate).toFixed(4),
      interestMethod: input.interestMethod,
      termMonths: input.termMonths,
      currency,
      totalInterest: cost.totalInterest,
      totalFees: cost.totalFees,
      totalPayable: cost.totalPayable,
      principalOutstanding: disbursed ? toMoneyString(input.principal) : "0.00",
      interestOutstanding: disbursed ? cost.totalInterest : "0.00",
      collateralDescription: input.collateralDescription ?? null,
      collateralAmount:
        input.collateralAmount === null || input.collateralAmount === undefined
          ? null
          : toMoneyString(input.collateralAmount),
      disbursedAt: input.disbursedAt ?? null,
      firstPaymentDue: input.firstPaymentDue ?? null,
      nextPaymentDue: input.firstPaymentDue ?? null,
      maturityDate: input.maturityDate ?? null,
      isPublic: input.isPublic ?? true,
      recordedById: input.actorId,
    },
    select: { id: true, reference: true },
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.BORROWING_RECORDED,
      entityType: "InstitutionalLoan",
      entityId: created.id,
      associationId: input.associationId,
      newValue: {
        reference: created.reference,
        lender: input.lenderName,
        principal: toMoneyString(input.principal),
        totalPayable: cost.totalPayable,
        purpose: input.purpose,
        isPublic: input.isPublic ?? true,
      },
      // A debt secured on the members' savings is not routine bookkeeping.
      severity: "WARNING",
    },
    { id: input.actorId }
  );

  return created;
}

/**
 * The contracted cost of the facility.
 *
 * A supplied `totalInterest` is taken as given. Otherwise the same amortisation
 * used for member loans produces an estimate — monthly repayment, which is what
 * institutional facilities in this market almost always are.
 */
export function resolveCost(input: RecordBorrowingInput): {
  totalInterest: string;
  totalFees: string;
  totalPayable: string;
} {
  const totalFees = toMoneyString(input.totalFees ?? 0);

  const totalInterest =
    input.totalInterest !== null && input.totalInterest !== undefined
      ? toMoneyString(input.totalInterest)
      : toMoneyString(
          generateSchedule({
            principal: input.principal,
            annualRate: input.interestRate,
            method: input.interestMethod,
            termMonths: input.termMonths,
            frequency: "MONTHLY",
          }).totalInterest
        );

  return {
    totalInterest,
    totalFees,
    totalPayable: toMoneyString(add(input.principal, totalInterest, totalFees)),
  };
}

export interface UpdateBorrowingInput {
  id: string;
  actorId: string;
  purpose?: string;
  lenderName?: string;
  lenderReference?: string | null;
  lenderContact?: string | null;
  collateralDescription?: string | null;
  status?: InstitutionalLoanStatus;
  nextPaymentDue?: Date | null;
  maturityDate?: Date | null;
  isPublic?: boolean;
}

/**
 * Edits the descriptive and lifecycle fields of a facility.
 *
 * Deliberately cannot touch principal, rate, or any of the running totals.
 * Those are either contract terms or ledger-derived caches; changing them by
 * hand would break the invariant that the outstanding position always equals
 * the replayed repayment history. A wrong principal is corrected by cancelling
 * the record and entering it again, which leaves both acts in the audit log.
 */
export async function updateBorrowing(input: UpdateBorrowingInput): Promise<void> {
  const existing = await prisma.institutionalLoan.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      associationId: true,
      reference: true,
      status: true,
      purpose: true,
      isPublic: true,
      principalOutstanding: true,
      interestOutstanding: true,
    },
  });

  if (!existing) {
    throw new BorrowingError("Facility not found", "NOT_FOUND");
  }

  if (input.status === "COMPLETED") {
    const outstanding = add(existing.principalOutstanding, existing.interestOutstanding);
    if (gt(outstanding, 0)) {
      throw new BorrowingError(
        `Cannot close a facility with ${toMoneyString(outstanding)} still outstanding`,
        "INVALID_STATE"
      );
    }
  }

  await prisma.institutionalLoan.update({
    where: { id: input.id },
    data: {
      ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
      ...(input.lenderName !== undefined ? { lenderName: input.lenderName } : {}),
      ...(input.lenderReference !== undefined
        ? { lenderReference: input.lenderReference }
        : {}),
      ...(input.lenderContact !== undefined ? { lenderContact: input.lenderContact } : {}),
      ...(input.collateralDescription !== undefined
        ? { collateralDescription: input.collateralDescription }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.status === "COMPLETED" ? { completedAt: new Date() } : {}),
      ...(input.nextPaymentDue !== undefined
        ? { nextPaymentDue: input.nextPaymentDue }
        : {}),
      ...(input.maturityDate !== undefined ? { maturityDate: input.maturityDate } : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
    },
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.BORROWING_UPDATED,
      entityType: "InstitutionalLoan",
      entityId: existing.id,
      associationId: existing.associationId,
      oldValue: {
        status: existing.status,
        purpose: existing.purpose,
        isPublic: existing.isPublic,
      },
      newValue: {
        status: input.status ?? existing.status,
        purpose: input.purpose ?? existing.purpose,
        isPublic: input.isPublic ?? existing.isPublic,
      },
    },
    { id: input.actorId }
  );

  // Withdrawing a facility from the members' view is recorded as its own event
  // rather than buried inside a field diff, because it is the one change here
  // that reduces what members can see about their own security.
  if (input.isPublic !== undefined && input.isPublic !== existing.isPublic) {
    await recordAudit(
      {
        action: AUDIT_ACTIONS.BORROWING_VISIBILITY_CHANGED,
        entityType: "InstitutionalLoan",
        entityId: existing.id,
        associationId: existing.associationId,
        oldValue: { isPublic: existing.isPublic },
        newValue: { isPublic: input.isPublic },
        severity: input.isPublic ? "INFO" : "WARNING",
      },
      { id: input.actorId }
    );
  }
}

export interface RecordRepaymentInput {
  borrowingId: string;
  actorId: string;
  amount: MoneyInput;
  /// Explicit split from the lender's advice note. Anything left after
  /// interest and fees goes to principal.
  interestPortion?: MoneyInput | null;
  feesPortion?: MoneyInput | null;
  channel?: PaymentChannel;
  description?: string | null;
  externalReference?: string | null;
  paidAt?: Date;
  nextPaymentDue?: Date | null;
}

/**
 * Posts a repayment the association made to its lender.
 *
 * Runs under the same locking rule as the savings ledger: the facility row is
 * locked before its position is read, so two administrators entering the same
 * bank advice at once cannot both compute their split from the same stale
 * balance and drive the outstanding figure negative.
 */
export async function recordBorrowingRepayment(input: RecordRepaymentInput): Promise<{
  repaymentId: string;
  reference: string;
  outstanding: string;
  completed: boolean;
}> {
  const amount = toMoney(input.amount);

  if (!amount.greaterThan(0)) {
    throw new BorrowingError("A repayment must be greater than zero", "INVALID_ALLOCATION");
  }

  const result = await withFinancialTransaction(async (tx) => {
    const locked = await lockBorrowing(tx, input.borrowingId);

    if (locked.status === "COMPLETED" || locked.status === "CANCELLED") {
      throw new BorrowingError(
        `Cannot post a repayment against a ${locked.status.toLowerCase()} facility`,
        "INVALID_STATE"
      );
    }

    const owed = add(locked.principalOutstanding, locked.interestOutstanding);

    if (gt(amount, owed)) {
      throw new BorrowingError(
        `Repayment of ${toMoneyString(amount)} exceeds the ${toMoneyString(owed)} outstanding`,
        "OVERPAYMENT"
      );
    }

    const split = allocateRepayment({
      amount,
      interestOutstanding: locked.interestOutstanding,
      principalOutstanding: locked.principalOutstanding,
      statedInterest: input.interestPortion,
      statedFees: input.feesPortion,
    });

    const sequence = locked.lastSequence + 1;
    const interestOutstanding = subtract(locked.interestOutstanding, split.interest);
    const principalOutstanding = subtract(locked.principalOutstanding, split.principal);
    const balanceAfter = add(principalOutstanding, interestOutstanding);
    const cleared = !gt(balanceAfter, 0);

    const repayment = await tx.institutionalLoanRepayment.create({
      data: {
        institutionalLoanId: locked.id,
        sequence,
        reference: buildTransactionReference("BRP"),
        amount: toMoneyString(amount),
        principalPortion: toMoneyString(split.principal),
        interestPortion: toMoneyString(split.interest),
        feesPortion: toMoneyString(split.fees),
        balanceAfter: toMoneyString(balanceAfter),
        currency: locked.currency,
        channel: input.channel ?? "BANK_TRANSFER",
        description: input.description ?? null,
        externalReference: input.externalReference ?? null,
        paidAt: input.paidAt ?? new Date(),
        recordedById: input.actorId,
      },
      select: { id: true, reference: true },
    });

    await tx.institutionalLoan.update({
      where: { id: locked.id },
      data: {
        lastSequence: sequence,
        principalOutstanding: toMoneyString(principalOutstanding),
        interestOutstanding: toMoneyString(interestOutstanding),
        principalRepaid: toMoneyString(add(locked.principalRepaid, split.principal)),
        interestPaid: toMoneyString(add(locked.interestPaid, split.interest)),
        feesPaid: toMoneyString(add(locked.feesPaid, split.fees)),
        totalRepaid: toMoneyString(add(locked.totalRepaid, amount)),
        ...(cleared
          ? { status: "COMPLETED" as const, completedAt: new Date(), nextPaymentDue: null }
          : input.nextPaymentDue !== undefined
            ? { nextPaymentDue: input.nextPaymentDue }
            : {}),
        // A facility that was overdue and has now been paid down is no longer
        // overdue; leaving the flag set would report arrears that do not exist.
        ...(cleared || locked.status === "OVERDUE"
          ? { daysOverdue: 0, overdueAmount: "0.00" }
          : {}),
        ...(!cleared && locked.status === "OVERDUE" ? { status: "ACTIVE" as const } : {}),
      },
    });

    return {
      repaymentId: repayment.id,
      reference: repayment.reference,
      outstanding: toMoneyString(balanceAfter),
      completed: cleared,
      associationId: locked.associationId,
      borrowingReference: locked.reference,
      split,
    };
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.BORROWING_REPAYMENT_RECORDED,
      entityType: "InstitutionalLoan",
      entityId: input.borrowingId,
      associationId: result.associationId,
      newValue: {
        facility: result.borrowingReference,
        reference: result.reference,
        amount: toMoneyString(amount),
        principal: toMoneyString(result.split.principal),
        interest: toMoneyString(result.split.interest),
        fees: toMoneyString(result.split.fees),
        outstanding: result.outstanding,
      },
    },
    { id: input.actorId }
  );

  return {
    repaymentId: result.repaymentId,
    reference: result.reference,
    outstanding: result.outstanding,
    completed: result.completed,
  };
}

/**
 * `SELECT … FOR UPDATE` on the facility.
 *
 * Prisma has no first-class row lock, so this is raw SQL — the same technique
 * the savings ledger uses, and for the same reason: without it two concurrent
 * repayments both read the pre-payment position and the second one's
 * balanceAfter is wrong.
 */
async function lockBorrowing(
  tx: TxClient,
  id: string
): Promise<{
  id: string;
  associationId: string;
  reference: string;
  status: InstitutionalLoanStatus;
  currency: string;
  lastSequence: number;
  principalOutstanding: string;
  interestOutstanding: string;
  principalRepaid: string;
  interestPaid: string;
  feesPaid: string;
  totalRepaid: string;
}> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      associationId: string;
      reference: string;
      status: InstitutionalLoanStatus;
      currency: string;
      lastSequence: number;
      principalOutstanding: string;
      interestOutstanding: string;
      principalRepaid: string;
      interestPaid: string;
      feesPaid: string;
      totalRepaid: string;
    }[]
  >`
    SELECT id,
           "associationId",
           reference,
           status,
           currency,
           "lastSequence",
           "principalOutstanding"::text AS "principalOutstanding",
           "interestOutstanding"::text  AS "interestOutstanding",
           "principalRepaid"::text      AS "principalRepaid",
           "interestPaid"::text         AS "interestPaid",
           "feesPaid"::text             AS "feesPaid",
           "totalRepaid"::text          AS "totalRepaid"
    FROM institutional_loans
    WHERE id = ${id}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new BorrowingError("Facility not found", "NOT_FOUND");
  }

  return rows[0];
}

/**
 * Splits a repayment into fees, interest and principal.
 *
 * Exported for the tests. It decides how much of a payment reduces the debt
 * versus how much is simply the cost of carrying it, and that split feeds the
 * surplus figure every member is shown — it is worth proving rather than
 * trusting.
 *
 * Interest before principal, which is what every amortising facility does and
 * what the lender's own advice note will show. A stated split from that note
 * overrides the calculation — but is still capped at what is actually
 * outstanding, so a mistyped interest figure cannot drive the interest balance
 * below zero and quietly inflate the principal repaid.
 */
export function allocateRepayment(params: {
  amount: MoneyInput;
  interestOutstanding: MoneyInput;
  principalOutstanding: MoneyInput;
  statedInterest?: MoneyInput | null;
  statedFees?: MoneyInput | null;
}): { principal: MoneyInput; interest: MoneyInput; fees: MoneyInput } {
  const amount = toMoney(params.amount);

  const fees = min(toMoney(params.statedFees ?? 0), amount);
  const afterFees = subtract(amount, fees);

  const interest =
    params.statedInterest !== null && params.statedInterest !== undefined
      ? min(toMoney(params.statedInterest), afterFees, toMoney(params.interestOutstanding))
      : min(afterFees, toMoney(params.interestOutstanding));

  const principal = subtract(afterFees, interest);

  if (lt(principal, 0) || gt(principal, toMoney(params.principalOutstanding))) {
    throw new BorrowingError(
      "That split does not fit the amounts outstanding on this facility",
      "INVALID_ALLOCATION"
    );
  }

  return { principal, interest, fees };
}
