import "server-only";
import { prisma } from "@/lib/db/prisma";
import { toMoney, toMoneyString, type MoneyInput } from "@/lib/money";
import { buildTransactionReference } from "@/lib/services/ledger";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";
import type {
  FundingSource,
  InvestmentCategory,
  InvestmentStatus,
} from "@/lib/generated/prisma/enums";

/**
 * What the association did with the money.
 *
 * A balance is not an answer. A member who is told the association holds
 * 40,000,000 and owes a bank 12,000,000 still does not know what any of it was
 * for — and "what did our money actually do for us?" is the question that
 * decides whether they keep contributing.
 *
 * So these rows are written for members, not for accountants. `benefitSummary`
 * carries the part that matters to them; `amountReturned` carries the part
 * that has to be true. Only realised returns belong in that column: a
 * projection dressed up as a return would flow straight into the surplus the
 * member is shown and into their share of it.
 */

export class InvestmentError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID_STATE"
  ) {
    super(message);
    this.name = "InvestmentError";
  }
}

export interface InvestmentSummary {
  id: string;
  reference: string;
  title: string;
  category: InvestmentCategory;
  status: InvestmentStatus;
  summary: string;
  description: string | null;
  benefitSummary: string | null;
  membersBenefited: number | null;
  fundingSource: FundingSource;
  amountInvested: string;
  amountReturned: string;
  /// Returns less what went in. Negative while an investment is still young,
  /// which is normal and is shown rather than hidden.
  netReturn: string;
  /// Return as a percentage of the amount invested. Null when nothing was
  /// invested, rather than a division by zero rendered as "Infinity%".
  returnPercent: number | null;
  currency: string;
  startedAt: Date | null;
  completedAt: Date | null;
  isPublic: boolean;
  createdAt: Date;
  fundedBy: { id: string; reference: string; lenderName: string } | null;
}

const INVESTMENT_SELECT = {
  id: true,
  reference: true,
  title: true,
  category: true,
  status: true,
  summary: true,
  description: true,
  benefitSummary: true,
  membersBenefited: true,
  fundingSource: true,
  amountInvested: true,
  amountReturned: true,
  currency: true,
  startedAt: true,
  completedAt: true,
  isPublic: true,
  createdAt: true,
  fundedByLoan: { select: { id: true, reference: true, lenderName: true } },
} as const;

/** Statuses where the association's capital is still committed. */
export const DEPLOYED_INVESTMENT_STATUSES = [
  "PLANNED",
  "ACTIVE",
  "PAUSED",
] as const satisfies readonly InvestmentStatus[];

/**
 * Everything the association has put money into.
 *
 * As with borrowings, `includeUnpublished` defaults to false: the members' view
 * is what a forgetful caller gets.
 */
export async function listInvestments(
  associationId: string | null,
  options: { includeUnpublished?: boolean } = {}
): Promise<InvestmentSummary[]> {
  const rows = await prisma.associationInvestment.findMany({
    where: {
      ...(associationId ? { associationId } : {}),
      ...(options.includeUnpublished ? {} : { isPublic: true }),
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    select: INVESTMENT_SELECT,
  });

  return rows.map(toInvestmentSummary);
}

export async function getInvestment(
  id: string
): Promise<(InvestmentSummary & { associationId: string }) | null> {
  const row = await prisma.associationInvestment.findUnique({
    where: { id },
    select: { ...INVESTMENT_SELECT, associationId: true },
  });

  if (!row) return null;
  return { ...toInvestmentSummary(row), associationId: row.associationId };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- one mapper over two
   selects that share every field the mapper reads. */
function toInvestmentSummary(row: any): InvestmentSummary {
  const invested = toMoney(row.amountInvested);
  const returned = toMoney(row.amountReturned);

  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    category: row.category,
    status: row.status,
    summary: row.summary,
    description: row.description,
    benefitSummary: row.benefitSummary,
    membersBenefited: row.membersBenefited,
    fundingSource: row.fundingSource,
    amountInvested: invested.toFixed(2),
    amountReturned: returned.toFixed(2),
    netReturn: toMoneyString(returned.minus(invested)),
    returnPercent: invested.greaterThan(0)
      ? Math.round(returned.dividedBy(invested).times(100).toNumber())
      : null,
    currency: row.currency,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    isPublic: row.isPublic,
    createdAt: row.createdAt,
    fundedBy: row.fundedByLoan
      ? {
          id: row.fundedByLoan.id,
          reference: row.fundedByLoan.reference,
          lenderName: row.fundedByLoan.lenderName,
        }
      : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface RecordInvestmentInput {
  associationId: string;
  actorId: string;
  title: string;
  category: InvestmentCategory;
  status?: InvestmentStatus;
  summary: string;
  description?: string | null;
  benefitSummary?: string | null;
  membersBenefited?: number | null;
  fundingSource: FundingSource;
  fundedByLoanId?: string | null;
  amountInvested: MoneyInput;
  amountReturned?: MoneyInput | null;
  currency?: string;
  startedAt?: Date | null;
  completedAt?: Date | null;
  isPublic?: boolean;
}

export async function recordInvestment(
  input: RecordInvestmentInput
): Promise<{ id: string; reference: string }> {
  // A facility from another association must never become the stated source of
  // funds here — it would put one tenant's debt on another tenant's screen.
  if (input.fundedByLoanId) {
    await assertBorrowingBelongsTo(input.fundedByLoanId, input.associationId);
  }

  const reference = buildTransactionReference("INV");

  const created = await prisma.associationInvestment.create({
    data: {
      associationId: input.associationId,
      reference,
      title: input.title,
      category: input.category,
      status: input.status ?? "PLANNED",
      summary: input.summary,
      description: input.description ?? null,
      benefitSummary: input.benefitSummary ?? null,
      membersBenefited: input.membersBenefited ?? null,
      fundingSource: input.fundingSource,
      fundedByLoanId: input.fundedByLoanId ?? null,
      amountInvested: toMoneyString(input.amountInvested),
      amountReturned: toMoneyString(input.amountReturned ?? 0),
      currency: input.currency ?? "RWF",
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      isPublic: input.isPublic ?? true,
      recordedById: input.actorId,
    },
    select: { id: true, reference: true },
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.INVESTMENT_RECORDED,
      entityType: "AssociationInvestment",
      entityId: created.id,
      associationId: input.associationId,
      newValue: {
        reference: created.reference,
        title: input.title,
        amountInvested: toMoneyString(input.amountInvested),
        fundingSource: input.fundingSource,
        isPublic: input.isPublic ?? true,
      },
    },
    { id: input.actorId }
  );

  return created;
}

export interface UpdateInvestmentInput {
  id: string;
  actorId: string;
  title?: string;
  category?: InvestmentCategory;
  status?: InvestmentStatus;
  summary?: string;
  description?: string | null;
  benefitSummary?: string | null;
  membersBenefited?: number | null;
  fundingSource?: FundingSource;
  fundedByLoanId?: string | null;
  amountInvested?: MoneyInput;
  amountReturned?: MoneyInput;
  startedAt?: Date | null;
  completedAt?: Date | null;
  isPublic?: boolean;
}

/**
 * Edits an investment record.
 *
 * `amountInvested` and `amountReturned` ARE editable here, unlike the figures
 * on a borrowing. The difference is that those are ledger-derived caches with
 * an append-only history behind them, whereas these two are simply facts an
 * administrator asserts — there is no ledger to contradict. That makes the
 * audit entry below the only record of what a figure used to be, so both old
 * and new values are always captured.
 */
export async function updateInvestment(input: UpdateInvestmentInput): Promise<void> {
  const existing = await prisma.associationInvestment.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      associationId: true,
      reference: true,
      title: true,
      status: true,
      amountInvested: true,
      amountReturned: true,
      isPublic: true,
    },
  });

  if (!existing) {
    throw new InvestmentError("Investment not found", "NOT_FOUND");
  }

  if (input.fundedByLoanId) {
    await assertBorrowingBelongsTo(input.fundedByLoanId, existing.associationId);
  }

  await prisma.associationInvestment.update({
    where: { id: input.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.benefitSummary !== undefined
        ? { benefitSummary: input.benefitSummary }
        : {}),
      ...(input.membersBenefited !== undefined
        ? { membersBenefited: input.membersBenefited }
        : {}),
      ...(input.fundingSource !== undefined ? { fundingSource: input.fundingSource } : {}),
      ...(input.fundedByLoanId !== undefined
        ? { fundedByLoanId: input.fundedByLoanId }
        : {}),
      ...(input.amountInvested !== undefined
        ? { amountInvested: toMoneyString(input.amountInvested) }
        : {}),
      ...(input.amountReturned !== undefined
        ? { amountReturned: toMoneyString(input.amountReturned) }
        : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.status === "COMPLETED" && input.completedAt === undefined
        ? { completedAt: new Date() }
        : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
    },
  });

  await recordAudit(
    {
      action: AUDIT_ACTIONS.INVESTMENT_UPDATED,
      entityType: "AssociationInvestment",
      entityId: existing.id,
      associationId: existing.associationId,
      oldValue: {
        title: existing.title,
        status: existing.status,
        amountInvested: existing.amountInvested.toFixed(2),
        amountReturned: existing.amountReturned.toFixed(2),
      },
      newValue: {
        title: input.title ?? existing.title,
        status: input.status ?? existing.status,
        amountInvested:
          input.amountInvested !== undefined
            ? toMoneyString(input.amountInvested)
            : existing.amountInvested.toFixed(2),
        amountReturned:
          input.amountReturned !== undefined
            ? toMoneyString(input.amountReturned)
            : existing.amountReturned.toFixed(2),
      },
    },
    { id: input.actorId }
  );

  if (input.isPublic !== undefined && input.isPublic !== existing.isPublic) {
    await recordAudit(
      {
        action: AUDIT_ACTIONS.INVESTMENT_VISIBILITY_CHANGED,
        entityType: "AssociationInvestment",
        entityId: existing.id,
        associationId: existing.associationId,
        oldValue: { isPublic: existing.isPublic },
        newValue: { isPublic: input.isPublic },
      },
      { id: input.actorId }
    );
  }
}

async function assertBorrowingBelongsTo(
  borrowingId: string,
  associationId: string
): Promise<void> {
  const facility = await prisma.institutionalLoan.findUnique({
    where: { id: borrowingId },
    select: { associationId: true },
  });

  if (!facility || facility.associationId !== associationId) {
    throw new InvestmentError(
      "That facility does not belong to this association",
      "INVALID_STATE"
    );
  }
}

/**
 * Totals for the member-facing page, computed in the database.
 *
 * Split by whether the capital is still committed: an association with
 * 8,000,000 in a completed project that has already paid for itself is in a
 * different position from one with 8,000,000 still tied up, and a single
 * "invested" figure cannot tell a member which they are looking at.
 */
export async function summariseInvestments(
  associationId: string | null,
  options: { includeUnpublished?: boolean } = {}
): Promise<{
  count: number;
  totalInvested: string;
  totalReturned: string;
  deployedCapital: string;
  membersBenefited: number;
}> {
  const scope = {
    ...(associationId ? { associationId } : {}),
    ...(options.includeUnpublished ? {} : { isPublic: true }),
  };

  const [all, deployed, benefited] = await Promise.all([
    prisma.associationInvestment.aggregate({
      where: { ...scope, status: { not: "CANCELLED" } },
      _sum: { amountInvested: true, amountReturned: true },
      _count: true,
    }),

    prisma.associationInvestment.aggregate({
      where: { ...scope, status: { in: [...DEPLOYED_INVESTMENT_STATUSES] } },
      _sum: { amountInvested: true },
    }),

    // The largest single figure, not the sum: the same thirty tailors using
    // both a new machine and a bulk-fabric scheme are thirty people, not
    // sixty, and adding the columns would quietly overstate the reach of the
    // association's spending on the page members read.
    prisma.associationInvestment.aggregate({
      where: { ...scope, status: { not: "CANCELLED" } },
      _max: { membersBenefited: true },
    }),
  ]);

  return {
    count: all._count,
    totalInvested: toMoneyString(all._sum.amountInvested ?? 0),
    totalReturned: toMoneyString(all._sum.amountReturned ?? 0),
    deployedCapital: toMoneyString(deployed._sum.amountInvested ?? 0),
    membersBenefited: benefited._max.membersBenefited ?? 0,
  };
}
