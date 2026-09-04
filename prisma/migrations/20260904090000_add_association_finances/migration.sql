-- Association finances: what the association borrowed, and what it did with
-- the money.
--
-- Two liabilities/assets that had no home in the schema before. Member loans
-- (`loans`) are money the association lent OUT; `institutional_loans` is money
-- it borrowed IN, usually against the members' pooled savings. They are
-- deliberately separate tables: summing them would report a debt as an asset.
--
-- Both tables carry `isPublic`, defaulting to true, because the screen these
-- feed is the members' one. An association that pledges its members' savings
-- to a bank owes those members the figures.

-- CreateEnum
CREATE TYPE "InstitutionalLoanStatus" AS ENUM (
    'PENDING_DISBURSEMENT',
    'ACTIVE',
    'OVERDUE',
    'COMPLETED',
    'DEFAULTED',
    'CANCELLED',
    'WRITTEN_OFF'
);

-- CreateEnum
CREATE TYPE "LenderType" AS ENUM (
    'BANK',
    'MICROFINANCE',
    'SACCO',
    'GOVERNMENT_PROGRAMME',
    'NGO',
    'COOPERATIVE_UNION',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "InvestmentCategory" AS ENUM (
    'EQUIPMENT',
    'WORKSHOP_SPACE',
    'BULK_MATERIALS',
    'TRAINING',
    'MARKET_ACCESS',
    'PROPERTY',
    'MEMBER_LENDING',
    'EMERGENCY_FUND',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM (
    'MEMBER_SAVINGS',
    'BANK_LOAN',
    'RETAINED_SURPLUS',
    'GRANT',
    'MIXED'
);

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM (
    'PLANNED',
    'ACTIVE',
    'COMPLETED',
    'PAUSED',
    'CANCELLED'
);

-- CreateTable
CREATE TABLE "institutional_loans" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "InstitutionalLoanStatus" NOT NULL DEFAULT 'PENDING_DISBURSEMENT',
    "lenderName" TEXT NOT NULL,
    "lenderType" "LenderType" NOT NULL DEFAULT 'BANK',
    "lenderReference" TEXT,
    "lenderContact" TEXT,
    "purpose" TEXT NOT NULL,
    "principal" DECIMAL(18,2) NOT NULL,
    "interestRate" DECIMAL(9,4) NOT NULL,
    "interestMethod" "InterestMethod" NOT NULL DEFAULT 'REDUCING_BALANCE',
    "interestPeriod" TEXT NOT NULL DEFAULT 'ANNUAL',
    "termMonths" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "totalInterest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalFees" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "principalOutstanding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "interestOutstanding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "principalRepaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feesPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalRepaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastSequence" INTEGER NOT NULL DEFAULT 0,
    "collateralDescription" TEXT,
    "collateralAmount" DECIMAL(18,2),
    "disbursedAt" TIMESTAMP(3),
    "firstPaymentDue" TIMESTAMP(3),
    "nextPaymentDue" TIMESTAMP(3),
    "maturityDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "daysOverdue" INTEGER NOT NULL DEFAULT 0,
    "overdueAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "institutional_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "institutional_loan_repayments" (
    "id" TEXT NOT NULL,
    "institutionalLoanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "principalPortion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "interestPortion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "feesPortion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "channel" "PaymentChannel" NOT NULL DEFAULT 'BANK_TRANSFER',
    "description" TEXT,
    "externalReference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "institutional_loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_investments" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "InvestmentCategory" NOT NULL DEFAULT 'OTHER',
    "status" "InvestmentStatus" NOT NULL DEFAULT 'PLANNED',
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "benefitSummary" TEXT,
    "membersBenefited" INTEGER,
    "fundingSource" "FundingSource" NOT NULL DEFAULT 'MEMBER_SAVINGS',
    "fundedByLoanId" TEXT,
    "amountInvested" DECIMAL(18,2) NOT NULL,
    "amountReturned" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_investments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "institutional_loans_reference_key" ON "institutional_loans"("reference");

-- The admin portfolio screen, filtered by status.
CREATE INDEX "institutional_loans_associationId_status_idx" ON "institutional_loans"("associationId", "status");

-- The member-facing query: this association's published facilities only.
CREATE INDEX "institutional_loans_associationId_isPublic_idx" ON "institutional_loans"("associationId", "isPublic");

-- "what falls due next" across every association, for the reminder job.
CREATE INDEX "institutional_loans_nextPaymentDue_idx" ON "institutional_loans"("nextPaymentDue");

-- CreateIndex
CREATE UNIQUE INDEX "institutional_loan_repayments_reference_key" ON "institutional_loan_repayments"("reference");

-- The gap-detection constraint: two writers cannot claim the same ledger slot.
CREATE UNIQUE INDEX "institutional_loan_repayments_institutionalLoanId_sequence_key" ON "institutional_loan_repayments"("institutionalLoanId", "sequence");

-- CreateIndex
CREATE INDEX "institutional_loan_repayments_institutionalLoanId_paidAt_idx" ON "institutional_loan_repayments"("institutionalLoanId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "association_investments_reference_key" ON "association_investments"("reference");

-- CreateIndex
CREATE INDEX "association_investments_associationId_status_idx" ON "association_investments"("associationId", "status");

-- CreateIndex
CREATE INDEX "association_investments_associationId_isPublic_idx" ON "association_investments"("associationId", "isPublic");

-- CreateIndex
CREATE INDEX "association_investments_fundedByLoanId_idx" ON "association_investments"("fundedByLoanId");

-- AddForeignKey
ALTER TABLE "institutional_loans" ADD CONSTRAINT "institutional_loans_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_loans" ADD CONSTRAINT "institutional_loans_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_loan_repayments" ADD CONSTRAINT "institutional_loan_repayments_institutionalLoanId_fkey" FOREIGN KEY ("institutionalLoanId") REFERENCES "institutional_loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "institutional_loan_repayments" ADD CONSTRAINT "institutional_loan_repayments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_investments" ADD CONSTRAINT "association_investments_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_investments" ADD CONSTRAINT "association_investments_fundedByLoanId_fkey" FOREIGN KEY ("fundedByLoanId") REFERENCES "institutional_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_investments" ADD CONSTRAINT "association_investments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
