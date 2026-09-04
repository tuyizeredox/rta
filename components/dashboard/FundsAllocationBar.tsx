import { formatMoney, toMoney } from "@/lib/money";

/**
 * A single bar showing how the association's money is split.
 *
 * Not a pie chart, and not a charting library. Three or four proportions read
 * faster as one horizontal bar than as a donut, it renders on the server with
 * no JavaScript at all, and it survives being printed — which matters, because
 * the treasurer prints this page for the general meeting.
 *
 * ON NEGATIVE SEGMENTS. The "not yet deployed" figure is a residual, and a
 * residual can come out negative when the association's records are incomplete.
 * A negative segment is given no width — there is no honest way to draw one —
 * but it keeps its place in the legend with its real value shown. Dropping it
 * would leave a member looking at a bar whose parts do not add up to the total
 * above it, with nothing to explain why.
 */

export interface AllocationSegment {
  key: string;
  label: string;
  /// Decimal string. See lib/money.ts — never a number.
  amount: string;
  /// Tailwind background class for the bar segment.
  className: string;
}

export function FundsAllocationBar({
  segments,
  currency = "RWF",
}: {
  segments: AllocationSegment[];
  currency?: string;
}) {
  const drawable = segments.map((segment) => ({
    ...segment,
    value: toMoney(segment.amount),
  }));

  // Only positive segments contribute width, so the percentages always sum to
  // 100 across what is actually drawn.
  const total = drawable.reduce(
    (sum, segment) => (segment.value.isPositive() ? sum.plus(segment.value) : sum),
    toMoney(0)
  );

  const withShare = drawable.map((segment) => ({
    ...segment,
    percent:
      total.greaterThan(0) && segment.value.isPositive()
        ? segment.value.dividedBy(total).times(100).toNumber()
        : 0,
  }));

  return (
    <div className="mt-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink/[0.06]">
        {withShare.map((segment) =>
          segment.percent > 0 ? (
            <div
              key={segment.key}
              className={segment.className}
              style={{ width: `${segment.percent}%` }}
              // The legend below carries the same information as text, so the
              // bar itself is decoration to a screen reader.
              aria-hidden="true"
            />
          ) : null
        )}
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {withShare.map((segment) => (
          <div key={segment.key} className="min-w-0">
            <dt className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              <span
                className={`size-2.5 shrink-0 rounded-full ${segment.className}`}
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{segment.label}</span>
            </dt>
            <dd className="mt-1 pl-4.5">
              <span
                className={`font-heading text-base font-bold tabular-nums ${
                  segment.value.isNegative() ? "text-red-700" : "text-ink"
                }`}
              >
                {formatMoney(segment.amount, { currency })}
              </span>
              {segment.percent > 0 && (
                <span className="ml-1.5 text-xs text-ink-muted">
                  {Math.round(segment.percent)}%
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
