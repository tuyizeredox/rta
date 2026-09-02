import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  HandCoins,
  PiggyBank,
  QrCode,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { requireAuth } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_HOME } from "@/lib/auth/permissions";
import { getAccountStatusSummary } from "@/lib/services/account-status";
import { formatMoney } from "@/lib/money";
import { getDashboardCopy } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { PageHeader } from "@/components/dashboard/DashboardShell";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EnrolAsMemberButton } from "@/components/account/EnrolAsMemberButton";

/**
 * Account status — the first screen after a QR sign-in, and a page in its own
 * right the rest of the time.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE DASHBOARD. Someone who has just held a
 * card up to a camera has one question, and it is not "how have my
 * contributions trended". It is "am I in good standing, and what is my
 * balance". The dashboard answers that too, eventually, underneath four charts
 * and a transactions table. This page answers it in the first screenful, on a
 * cheap phone, over a slow connection, and then gets out of the way with a
 * single link onward.
 *
 * It is written for every role. Staff in a savings association usually save
 * with it as well, so an administrator sees their own balance here exactly as
 * a member does; one who has no member record sees an honest panel saying so
 * rather than a row of zeroes.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getDashboardCopy();
  return {
    title: `${d.account.status.title} | RTA Savings & Loans`,
    robots: { index: false, follow: false },
  };
}

// Balances must never come from a cache — this page exists to be trusted.
export const dynamic = "force-dynamic";

export default async function AccountStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ via?: string }>;
}) {
  const context = await requireAuth("/account/status");
  const params = await searchParams;
  const { d, locale } = await getDashboardCopy();
  const copy = d.account.status;

  const summary = context.member
    ? await getAccountStatusSummary(context.member.id)
    : null;

  const currency = context.association?.currency ?? "RWF";
  const money = (value: string | null | undefined) =>
    formatMoney(value ?? "0", { currency });

  const overdueDays = summary?.loan?.daysOverdue ?? 0;
  const suspended =
    summary?.status === "SUSPENDED" || context.user.status === "SUSPENDED";

  // Staff who have no savings account yet, and the standing to open one. The
  // association is what makes it possible at all: a platform-level super admin
  // belongs to none, so there is no register to join and no ledger to join it
  // in. The route handler re-checks every part of this.
  const canOpenSavings =
    !summary &&
    Boolean(context.user.associationId) &&
    context.permissions.has(PERMISSIONS.MEMBERS_CREATE);

  return (
    <div className="space-y-6">
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/account/qr">
                <QrCode className="size-3.5" aria-hidden="true" />
                {copy.myQrCode}
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href={ROLE_HOME[context.user.role]}>
                {copy.continueToDashboard}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>
          </>
        }
      />

      {params.via === "qr" && (
        <Alert variant="success">{copy.signedInWithQr}</Alert>
      )}

      {/* The headline. Whatever else is on this page, the reader must be able
          to answer "am I all right?" from the first card. */}
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {summary ? copy.membership : copy.role}
            </p>
            <h2 className="mt-1.5 break-words font-heading text-xl font-bold text-ink sm:text-2xl">
              {context.user.fullName}
            </h2>
            {context.association && (
              <p className="mt-1 text-sm text-ink-muted">
                {copy.association}: {context.association.name}
              </p>
            )}
          </div>

          {/* An administrator who also saves with the association wears both
              labels, and needs to: the role explains what they may do to other
              people's records, the membership status explains what is
              happening to their own. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {context.user.role !== "MEMBER" && (
              <StatusBadge status={context.user.role} />
            )}
            {summary && <StatusBadge status={summary.status} />}
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-5">
          {suspended ? (
            <Alert variant="error" title={copy.suspendedTitle}>
              {copy.suspendedBody}
            </Alert>
          ) : overdueDays > 0 ? (
            <Alert variant="warning" title={copy.overdueTitle}>
              {fill(copy.overdueBody, { days: overdueDays })}
            </Alert>
          ) : summary ? (
            <Alert variant="success" title={copy.goodStandingTitle}>
              {copy.goodStandingBody}
            </Alert>
          ) : (
            <Alert variant="info" title={copy.staffTitle}>
              {copy.staffBody}
              {canOpenSavings && <EnrolAsMemberButton />}
            </Alert>
          )}
        </div>
      </section>

      {summary && (
        <>
          {summary.savings ? (
            <StatGrid columns={4}>
              <StatCard
                label={copy.savingsBalance}
                value={money(summary.savings.balance)}
                icon={PiggyBank}
                tone="primary"
                href="/dashboard/savings"
              />
              <StatCard
                label={copy.availableToWithdraw}
                value={money(summary.savings.available)}
                icon={Receipt}
                href="/dashboard/withdrawals"
              />
              <StatCard
                label={copy.outstandingLoan}
                value={summary.loan ? money(summary.loan.outstanding) : money("0")}
                hint={summary.loan?.reference ?? copy.nothingOwed}
                icon={HandCoins}
                tone={overdueDays > 0 ? "danger" : "default"}
                href="/dashboard/loans"
              />
              <StatCard
                label={copy.nextRepayment}
                value={
                  summary.loan?.nextInstalment
                    ? money(summary.loan.nextInstalment.amount)
                    : "—"
                }
                hint={
                  summary.loan?.nextInstalment
                    ? formatDate(summary.loan.nextInstalment.dueDate, locale)
                    : copy.noRepaymentScheduled
                }
                icon={CalendarClock}
                tone={overdueDays > 0 ? "danger" : "default"}
              />
            </StatGrid>
          ) : (
            <Alert variant="info">{copy.noSavingsAccount}</Alert>
          )}

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-card lg:col-span-2">
              <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-ink">
                <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
                {copy.membership}
              </h2>

              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Detail label={copy.memberNumber} value={summary.memberNumber} mono />
                <Detail
                  label={copy.memberSince}
                  value={
                    summary.joinedAt
                      ? formatDate(summary.joinedAt, locale)
                      : copy.notRecorded
                  }
                />
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    {copy.identityCheck}
                  </dt>
                  <dd className="mt-1.5">
                    <StatusBadge status={summary.kycStatus} size="sm" />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    {copy.accountState}
                  </dt>
                  <dd className="mt-1.5">
                    <StatusBadge status={context.user.status} size="sm" />
                  </dd>
                </div>
              </dl>
            </div>

            {/* The payment reference travels with the member, so it belongs on
                the screen they reach by scanning a card at a pay point. */}
            <div className="rounded-2xl border border-primary/25 bg-primary-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary-hover">
                {copy.paymentReference}
              </p>
              <p className="mt-2 break-all font-heading text-xl font-bold tracking-tight text-primary-hover sm:text-2xl">
                {summary.paymentReference}
              </p>
              <p className="mt-3 text-xs leading-relaxed text-primary-hover/80">
                {copy.paymentReferenceHint}
              </p>
            </div>
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button asChild>
          <Link href={ROLE_HOME[context.user.role]}>
            {copy.continueToDashboard}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>

        {/* Staff who also save need both destinations named, because for them
            "my dashboard" is ambiguous: one is the association's, the other is
            their own money. */}
        {summary && context.user.role !== "MEMBER" && (
          <Button asChild variant="outline">
            <Link href="/dashboard">
              <PiggyBank className="size-4" aria-hidden="true" />
              {d.nav.myDashboard}
            </Link>
          </Button>
        )}

        <Button asChild variant="outline">
          <Link href="/account/qr">
            <QrCode className="size-4" aria-hidden="true" />
            {copy.myQrCode}
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </dt>
      <dd
        className={`mt-1.5 break-words text-[15px] font-semibold text-ink ${
          mono ? "font-mono tracking-wide" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
