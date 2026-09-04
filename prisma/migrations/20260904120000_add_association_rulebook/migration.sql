-- The rulebook: written policy the software actually enforces, plus the
-- records that policy produces.
--
-- Four things arrive together because they are one feature:
--
--   association_rules            the rules themselves, human text and machine
--                                value in one row, amendable with a trail
--   contribution_fines           what falling behind on the daily saving costs
--   platform_fee_charges         the service fee, kept OUT of association
--                                income because it was never the association's
--   interest_distributions       how each repayment's interest was divided
--                                between the borrower's savings and the
--                                association
--
-- The separation is the point. Before this migration a fee debit and a service
-- fee were the same kind of ledger row, and an association's income report
-- counted money it was only collecting on the platform's behalf.

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM (
    'CONTRIBUTIONS',
    'PLATFORM_FEE',
    'PENALTIES',
    'LENDING_ELIGIBILITY',
    'LOAN_TERMS',
    'INTEREST_SHARING',
    'GOVERNANCE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "RuleValueType" AS ENUM (
    'MONEY',
    'PERCENT',
    'DAYS',
    'MONTHS',
    'COUNT',
    'BOOLEAN',
    'TEXT'
);

-- CreateEnum
CREATE TYPE "RuleEnforcement" AS ENUM (
    'AUTOMATIC',
    'ASSISTED',
    'INFORMATIONAL'
);

-- CreateEnum
CREATE TYPE "ContributionFineStatus" AS ENUM (
    'OUTSTANDING',
    'SETTLED',
    'WAIVED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "PlatformFeeStatus" AS ENUM (
    'CHARGED',
    'WAIVED',
    'REVERSED'
);

-- CreateTable
CREATE TABLE "association_rules" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "valueType" "RuleValueType" NOT NULL,
    "enforcement" "RuleEnforcement" NOT NULL DEFAULT 'INFORMATIONAL',
    "value" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "titleEn" TEXT NOT NULL,
    "titleRw" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyRw" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "association_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "association_rule_revisions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleRw" TEXT NOT NULL,
    "bodyEn" TEXT NOT NULL,
    "bodyRw" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "changedById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "association_rule_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribution_fines" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "missedDays" INTEGER NOT NULL,
    "dueDayIndex" INTEGER NOT NULL,
    "arrearsAmount" DECIMAL(18,2) NOT NULL,
    "rate" DECIMAL(9,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "status" "ContributionFineStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedById" TEXT,
    "settledAt" TIMESTAMP(3),
    "savingsTransactionId" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedById" TEXT,
    "waiverReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribution_fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_contribution_standings" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "obligationStartDate" TIMESTAMP(3),
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptReason" TEXT,
    "exemptUntil" TIMESTAMP(3),
    "lastReminderStage" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_contribution_standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_fee_charges" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "daysCovered" INTEGER NOT NULL,
    "coveredThroughDay" INTEGER NOT NULL,
    "feePerDay" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "status" "PlatformFeeStatus" NOT NULL DEFAULT 'CHARGED',
    "savingsTransactionId" TEXT,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargedById" TEXT,
    "remittedAt" TIMESTAMP(3),
    "waiverReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interest_distributions" (
    "id" TEXT NOT NULL,
    "associationId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "loanTransactionId" TEXT NOT NULL,
    "interestCollected" DECIMAL(18,2) NOT NULL,
    "memberShare" DECIMAL(18,2) NOT NULL,
    "associationShare" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "memberRate" DECIMAL(9,4) NOT NULL,
    "associationRate" DECIMAL(9,4) NOT NULL,
    "savingsTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "association_rules_associationId_key_key" ON "association_rules"("associationId", "key");
CREATE INDEX "association_rules_associationId_category_displayOrder_idx" ON "association_rules"("associationId", "category", "displayOrder");
CREATE INDEX "association_rules_associationId_isActive_idx" ON "association_rules"("associationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "association_rule_revisions_ruleId_version_key" ON "association_rule_revisions"("ruleId", "version");
CREATE INDEX "association_rule_revisions_ruleId_createdAt_idx" ON "association_rule_revisions"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contribution_fines_reference_key" ON "contribution_fines"("reference");
CREATE UNIQUE INDEX "contribution_fines_savingsTransactionId_key" ON "contribution_fines"("savingsTransactionId");
-- The idempotency guarantee for the nightly assessment job: one fine per
-- member per obligation day, whatever happens to the schedule.
CREATE UNIQUE INDEX "contribution_fines_memberId_dueDayIndex_key" ON "contribution_fines"("memberId", "dueDayIndex");
CREATE INDEX "contribution_fines_associationId_status_assessedAt_idx" ON "contribution_fines"("associationId", "status", "assessedAt");
CREATE INDEX "contribution_fines_memberId_assessedAt_idx" ON "contribution_fines"("memberId", "assessedAt");

-- CreateIndex
CREATE UNIQUE INDEX "member_contribution_standings_memberId_key" ON "member_contribution_standings"("memberId");
CREATE INDEX "member_contribution_standings_associationId_isExempt_idx" ON "member_contribution_standings"("associationId", "isExempt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_charges_reference_key" ON "platform_fee_charges"("reference");
CREATE UNIQUE INDEX "platform_fee_charges_savingsTransactionId_key" ON "platform_fee_charges"("savingsTransactionId");
-- Same discipline as the fines: the fee-charging job may run twice, and must
-- not bill the member's savings twice for the same contribution days.
CREATE UNIQUE INDEX "platform_fee_charges_memberId_coveredThroughDay_key" ON "platform_fee_charges"("memberId", "coveredThroughDay");
CREATE INDEX "platform_fee_charges_associationId_chargedAt_idx" ON "platform_fee_charges"("associationId", "chargedAt");
CREATE INDEX "platform_fee_charges_associationId_status_remittedAt_idx" ON "platform_fee_charges"("associationId", "status", "remittedAt");
CREATE INDEX "platform_fee_charges_memberId_chargedAt_idx" ON "platform_fee_charges"("memberId", "chargedAt");

-- CreateIndex
CREATE UNIQUE INDEX "interest_distributions_loanTransactionId_key" ON "interest_distributions"("loanTransactionId");
CREATE UNIQUE INDEX "interest_distributions_savingsTransactionId_key" ON "interest_distributions"("savingsTransactionId");
CREATE INDEX "interest_distributions_associationId_createdAt_idx" ON "interest_distributions"("associationId", "createdAt");
CREATE INDEX "interest_distributions_memberId_createdAt_idx" ON "interest_distributions"("memberId", "createdAt");
CREATE INDEX "interest_distributions_loanId_createdAt_idx" ON "interest_distributions"("loanId", "createdAt");

-- AddForeignKey
ALTER TABLE "association_rules" ADD CONSTRAINT "association_rules_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "association_rules" ADD CONSTRAINT "association_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "association_rules" ADD CONSTRAINT "association_rules_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "association_rule_revisions" ADD CONSTRAINT "association_rule_revisions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "association_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "association_rule_revisions" ADD CONSTRAINT "association_rule_revisions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_savingsTransactionId_fkey" FOREIGN KEY ("savingsTransactionId") REFERENCES "savings_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contribution_fines" ADD CONSTRAINT "contribution_fines_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_contribution_standings" ADD CONSTRAINT "member_contribution_standings_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_contribution_standings" ADD CONSTRAINT "member_contribution_standings_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fee_charges" ADD CONSTRAINT "platform_fee_charges_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_fee_charges" ADD CONSTRAINT "platform_fee_charges_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_fee_charges" ADD CONSTRAINT "platform_fee_charges_savingsTransactionId_fkey" FOREIGN KEY ("savingsTransactionId") REFERENCES "savings_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_fee_charges" ADD CONSTRAINT "platform_fee_charges_chargedById_fkey" FOREIGN KEY ("chargedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interest_distributions" ADD CONSTRAINT "interest_distributions_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "associations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_distributions" ADD CONSTRAINT "interest_distributions_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_distributions" ADD CONSTRAINT "interest_distributions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_distributions" ADD CONSTRAINT "interest_distributions_loanTransactionId_fkey" FOREIGN KEY ("loanTransactionId") REFERENCES "loan_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interest_distributions" ADD CONSTRAINT "interest_distributions_savingsTransactionId_fkey" FOREIGN KEY ("savingsTransactionId") REFERENCES "savings_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
