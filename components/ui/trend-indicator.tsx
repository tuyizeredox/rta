"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { cn } from "@/lib/utils";

/**
 * The signed change beside a statistic.
 *
 * Split out of stat-card.tsx and marked "use client" only so it can read the
 * language: "No change" is the one word in a tile that is prose rather than a
 * number, and StatCard itself cannot be a client component because it is
 * handed a Lucide icon component by server components, which does not cross
 * the client boundary. Everything this receives is plain data.
 *
 * The arrow always sits beside a signed percentage — an arrow alone tells a
 * colour-blind reader nothing.
 */
export function TrendIndicator({
  percent,
  label,
  increaseIsGood = true,
}: {
  /// Signed percentage change. 0 renders as "no change".
  percent: number;
  label?: string;
  /// Set false where an increase is bad news (overdue loans, arrears).
  increaseIsGood?: boolean;
}) {
  const { d } = useLanguage();
  const rounded = Math.round(percent * 10) / 10;

  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
        <Minus className="size-3.5" aria-hidden="true" />
        {d.views.charts.noChange}
        {label && <span className="font-normal text-ink-muted">{label}</span>}
      </span>
    );
  }

  const rising = rounded > 0;
  const good = rising === increaseIsGood;
  const Arrow = rising ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold",
        good ? "text-emerald-700" : "text-red-600"
      )}
    >
      <Arrow className="size-3.5" aria-hidden="true" />
      {rising ? "+" : ""}
      {rounded}%
      {label && <span className="font-normal text-ink-muted">{label}</span>}
    </span>
  );
}
