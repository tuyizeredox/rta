"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, gt, lt, parseMoneyInput } from "@/lib/money";
import { generateSchedule } from "@/lib/services/loan-calculator";
import { useLanguage } from "@/components/LanguageProvider";
import { fill, pluralize, split } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import type { MemberCopy } from "@/lib/i18n/dashboard/member";
import type { ChargeType, InterestMethod, RepaymentFrequency } from "@/lib/generated/prisma/enums";

/**
 * Loan application form with a live repayment preview.
 *
 * The preview runs the SAME `generateSchedule` the server uses at
 * disbursement. That is the point: a member should see the real instalment,
 * the real total interest and — most importantly — the real amount that will
 * reach them after fees, before they commit. Showing an approximation here and
 * a different figure at disbursement is how associations lose members' trust.
 *
 * It remains a preview. Eligibility and final terms are decided server-side.
 */

interface Product {
  id: string;
  name: string;
  description: string | null;
  interestRate: string;
  interestMethod: InterestMethod;
  minAmount: string;
  maxAmount: string;
  minimumSavings: string;
  savingsMultiplier: string;
  minTermMonths: number;
  maxTermMonths: number;
  allowedFrequencies: RepaymentFrequency[];
  defaultFrequency: RepaymentFrequency;
  processingFeeType: ChargeType;
  processingFeeValue: string;
  insuranceFeeType: ChargeType;
  insuranceFeeValue: string;
  requiresGuarantors: boolean;
  minimumGuarantors: number;
  minimumMembershipMonths: number;
  singleActiveLoan: boolean;
  maxEligible: string;
  eligible: boolean;
}

/**
 * A repayment frequency in the reader's language.
 *
 * The dictionary keys carry the enum name so a new frequency in the schema is
 * a missing key rather than a silently English label; an unknown value falls
 * back to the raw enum, which is visible enough to get fixed.
 */
function frequencyLabel(value: string, copy: MemberCopy["apply"]): string {
  const key = `freq${value}` as keyof MemberCopy["apply"];
  return (copy[key] as string | undefined) ?? value;
}

export function LoanApplicationForm({
  products,
  savingsBalance,
  membershipMonths,
}: {
  products: Product[];
  savingsBalance: string;
  membershipMonths: number;
}) {
  const router = useRouter();
  const { d, locale } = useLanguage();
  const copy = d.member.apply;

  const [productId, setProductId] = useState(
    products.find((p) => p.eligible)?.id ?? products[0].id
  );
  const [amount, setAmount] = useState("");
  const [termMonths, setTermMonths] = useState("");
  const [frequency, setFrequency] = useState<string>("");
  const [purpose, setPurpose] = useState("");
  const [guarantors, setGuarantors] = useState<{ fullName: string; phone: string }[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const product = products.find((p) => p.id === productId)!;

  const effectiveTerm = termMonths || String(product.minTermMonths);
  const effectiveFrequency = (frequency || product.defaultFrequency) as RepaymentFrequency;

  const preview = useMemo(() => {
    const parsed = parseMoneyInput(amount, { allowZero: false });
    if (!parsed.ok) return null;

    const term = Number(effectiveTerm);
    if (!Number.isInteger(term) || term < 1) return null;

    try {
      return generateSchedule({
        principal: parsed.value,
        annualRate: product.interestRate,
        method: product.interestMethod,
        termMonths: term,
        frequency: effectiveFrequency,
        processingFeeType: product.processingFeeType,
        processingFeeValue: product.processingFeeValue,
        insuranceFeeType: product.insuranceFeeType,
        insuranceFeeValue: product.insuranceFeeValue,
      });
    } catch {
      return null;
    }
  }, [amount, effectiveTerm, effectiveFrequency, product]);

  const amountIssue = useMemo(() => {
    const parsed = parseMoneyInput(amount, { allowZero: false });
    if (!parsed.ok) return null;
    if (lt(parsed.value, product.minAmount)) {
      return fill(copy.amountTooSmall, {
        product: product.name,
        amount: formatMoney(product.minAmount),
      });
    }
    if (gt(parsed.value, product.maxEligible)) {
      return fill(copy.amountTooLarge, {
        savings: formatMoney(savingsBalance),
        amount: formatMoney(product.maxEligible),
      });
    }
    return null;
  }, [amount, product, savingsBalance, copy]);

  const termIssue =
    Number(effectiveTerm) < product.minTermMonths ||
    Number(effectiveTerm) > product.maxTermMonths
      ? fill(copy.termIssue, {
          min: product.minTermMonths,
          max: product.maxTermMonths,
        })
      : null;

  const guarantorIssue =
    product.requiresGuarantors &&
    guarantors.filter((g) => g.fullName.trim()).length < product.minimumGuarantors
      ? pluralize(copy.guarantorsMissing, product.minimumGuarantors)
      : null;

  const canSubmit =
    product.eligible &&
    preview !== null &&
    !amountIssue &&
    !termIssue &&
    !guarantorIssue &&
    purpose.trim().length >= 10 &&
    !submitting;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const response = await fetch("/api/loan-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loanProductId: productId,
          amount: preview ? preview.principal : amount,
          purpose: purpose.trim(),
          termMonths: Number(effectiveTerm),
          frequency: effectiveFrequency,
          guarantors: guarantors
            .filter((g) => g.fullName.trim())
            .map((g) => ({ fullName: g.fullName.trim(), phone: g.phone.trim() || undefined })),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        if (payload?.error?.details) setFieldErrors(payload.error.details);
        setError(payload?.error?.message ?? copy.submitFailed);
        setSubmitting(false);
        return;
      }

      setSuccess(payload.reference);
      router.refresh();
    } catch {
      setError(d.common.serverUnreachable);
      setSubmitting(false);
    }
  }

  // The reference is bold mid-sentence, and Kinyarwanda does not place it
  // where English does, so the sentence is split around the placeholder.
  const [successBefore, successAfter] = split(copy.successBody, "reference");

  if (success) {
    return (
      <Alert variant="success" title={copy.successTitle}>
        {successBefore}
        <strong>{success}</strong>
        {successAfter}{" "}
        <a href="/dashboard/loans" className="font-semibold underline">
          {copy.trackIt}
        </a>
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3" noValidate>
      <div className="space-y-5 lg:col-span-2">
        {error && <Alert variant="error">{error}</Alert>}

        {fieldErrors._ && (
          <Alert variant="error" title={copy.ineligibleTitle}>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {fieldErrors._.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          <Field id="loan-product" label={copy.productLabel} required>
            {() => (
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="loan-product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {fill(copy.productOption, {
                        name: p.name,
                        rate: p.interestRate,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {product.description && (
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              {product.description}
            </p>
          )}

          {!product.eligible && (
            <Alert variant="warning" className="mt-4">
              {product.minimumMembershipMonths > 0
                ? fill(copy.notEligibleSavingsTenure, {
                    savings: formatMoney(product.minimumSavings),
                    required: pluralize(
                      copy.monthsCount,
                      product.minimumMembershipMonths
                    ),
                    balance: formatMoney(savingsBalance),
                    actual: pluralize(copy.monthsCount, membershipMonths),
                  })
                : fill(copy.notEligibleSavings, {
                    savings: formatMoney(product.minimumSavings),
                    balance: formatMoney(savingsBalance),
                  })}
            </Alert>
          )}

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field
              id="loan-amount"
              label={copy.amountLabel}
              error={amountIssue ?? fieldErrors.amount}
              hint={fill(copy.amountHint, {
                amount: formatMoney(product.maxEligible),
              })}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="500000"
                />
              )}
            </Field>

            <Field
              id="loan-term"
              label={copy.termLabel}
              error={termIssue}
              hint={fill(copy.termHint, {
                min: product.minTermMonths,
                max: product.maxTermMonths,
              })}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  value={termMonths}
                  onChange={(e) => setTermMonths(e.target.value)}
                  placeholder={String(product.minTermMonths)}
                />
              )}
            </Field>
          </div>

          <div className="mt-5">
            <Field id="loan-frequency" label={copy.frequencyLabel} required>
              {() => (
                <Select
                  value={effectiveFrequency}
                  onValueChange={setFrequency}
                >
                  <SelectTrigger id="loan-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(product.allowedFrequencies.length
                      ? product.allowedFrequencies
                      : [product.defaultFrequency]
                    ).map((f) => (
                      <SelectItem key={f} value={f}>
                        {frequencyLabel(f, copy)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </div>

          <div className="mt-5">
            <Field
              id="loan-purpose"
              label={copy.purposeLabel}
              error={fieldErrors.purpose}
              hint={copy.purposeHint}
              required
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={copy.purposePlaceholder}
                  rows={3}
                />
              )}
            </Field>
          </div>
        </div>

        {product.requiresGuarantors && (
          <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
            <h3 className="font-heading text-base font-semibold text-ink">
              {copy.guarantorsTitle}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              {pluralize(copy.guarantorsRequired, product.minimumGuarantors)}
            </p>

            <div className="mt-4 space-y-3">
              {Array.from({ length: Math.max(product.minimumGuarantors, guarantors.length) }).map(
                (_, index) => (
                  <div key={index} className="grid gap-3 sm:grid-cols-2">
                    <Input
                      value={guarantors[index]?.fullName ?? ""}
                      onChange={(e) => {
                        const next = [...guarantors];
                        next[index] = { ...next[index], fullName: e.target.value, phone: next[index]?.phone ?? "" };
                        setGuarantors(next);
                      }}
                      placeholder={fill(copy.guarantorName, {
                        number: index + 1,
                      })}
                      aria-label={fill(copy.guarantorName, {
                        number: index + 1,
                      })}
                    />
                    <Input
                      value={guarantors[index]?.phone ?? ""}
                      onChange={(e) => {
                        const next = [...guarantors];
                        next[index] = { ...next[index], phone: e.target.value, fullName: next[index]?.fullName ?? "" };
                        setGuarantors(next);
                      }}
                      placeholder={d.common.phone}
                      aria-label={fill(copy.guarantorPhone, {
                        number: index + 1,
                      })}
                    />
                  </div>
                )
              )}
            </div>

            {guarantorIssue && (
              <p className="mt-2 text-xs font-medium text-red-600">{guarantorIssue}</p>
            )}
          </div>
        )}

        <Button type="submit" size="lg" disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {d.common.submitting}
            </>
          ) : (
            <>
              <Send className="size-4" aria-hidden="true" />
              {copy.submitApplication}
            </>
          )}
        </Button>
      </div>

      {/* Live repayment preview */}
      <aside className="lg:col-span-1">
        <div className="sticky top-24 rounded-2xl border border-primary/25 bg-primary-50 p-5">
          <h3 className="font-heading text-base font-semibold text-primary-hover">
            {copy.previewTitle}
          </h3>

          {!preview ? (
            <p className="mt-3 text-sm text-primary-hover/80">
              {copy.previewEmpty}
            </p>
          ) : (
            <>
              <dl className="mt-4 space-y-2.5 text-sm">
                <Line
                  label={copy.lineLoanAmount}
                  value={formatMoney(preview.principal)}
                />
                <Line
                  label={copy.lineProcessingFee}
                  value={formatMoney(preview.processingFee)}
                />
                <Line
                  label={copy.lineInsuranceFee}
                  value={formatMoney(preview.insuranceFee)}
                />
                <Line
                  label={copy.lineYouReceive}
                  value={formatMoney(preview.netDisbursement)}
                  strong
                />
                <div className="border-t border-primary/20 pt-2.5">
                  <Line
                    label={fill(copy.lineInterest, {
                      rate: product.interestRate,
                      method:
                        product.interestMethod === "FLAT"
                          ? copy.methodFlat
                          : copy.methodReducing,
                    })}
                    value={formatMoney(preview.totalInterest)}
                  />
                  <Line
                    label={copy.lineTotalRepay}
                    value={formatMoney(preview.totalPayable)}
                    strong
                  />
                </div>
              </dl>

              <div className="mt-4 rounded-xl bg-white/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary-hover">
                  {fill(copy.paymentLabel, {
                    frequency: frequencyLabel(effectiveFrequency, copy),
                  })}
                </p>
                <p className="mt-1 font-heading text-xl font-bold text-primary-hover">
                  {formatMoney(preview.instalments[1]?.totalDue ?? preview.instalments[0].totalDue)}
                </p>
                <p className="mt-1 text-xs text-primary-hover/75">
                  {fill(copy.paymentsCount, {
                    count: preview.instalments.length,
                    date: formatDate(preview.instalments[0].dueDate, locale),
                  })}
                </p>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-xs text-primary-hover/75">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {copy.previewNote}
              </p>
            </>
          )}
        </div>
      </aside>
    </form>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-semibold text-primary-hover" : "text-primary-hover/80"}>
        {label}
      </dt>
      <dd
        className={`tabular-nums ${strong ? "font-heading text-base font-bold text-primary-hover" : "font-medium text-primary-hover"}`}
      >
        {value}
      </dd>
    </div>
  );
}
