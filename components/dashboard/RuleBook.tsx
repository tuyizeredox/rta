import type { ReactNode } from "react";
import { CircleCheck, Hand, ScrollText } from "lucide-react";
import type { RuleRecord } from "@/lib/services/rulebook";
import { RULE_CATEGORY_ORDER } from "@/lib/rules/catalogue";
import { formatRuleValue } from "@/lib/rules/format";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import type { DashboardDictionary } from "@/lib/i18n/dashboard";
import type { Locale } from "@/types";
import { cn } from "@/lib/utils";

/**
 * THE RULES, RENDERED.
 *
 * One component, two audiences. The member's page and the committee's rulebook
 * show the same rules in the same order with the same words — the only
 * difference is that the committee's version passes an `actions` slot with an
 * edit button in it.
 *
 * That is deliberate and it is the point of the whole feature. Two components
 * would drift, and the drift would always go the same way: the admin screen
 * would gain a caveat or a qualifier that the member's copy never got, and a
 * member would be held to a rule worded differently from the one they read.
 *
 * A server component: it renders text and takes its language as a prop. The
 * interactive parts are passed in from outside as `actions`, so nothing here
 * ships to the browser.
 */

export interface RuleBookProps {
  rules: RuleRecord[];
  locale: Locale;
  d: DashboardDictionary;
  currency: string;
  /// Edit / history / delete controls, keyed by rule id. Absent for members.
  actions?: (rule: RuleRecord) => ReactNode;
  /// Show the enforcement badge. On by default — a member is entitled to know
  /// which rules the system applies without anybody deciding.
  showEnforcement?: boolean;
}

export function RuleBook({
  rules,
  locale,
  d,
  currency,
  actions,
  showEnforcement = true,
}: RuleBookProps) {
  const copy = d.rules;

  // Grouped in the order a member meets them — what you pay, what it costs,
  // what happens if you slip — not alphabetically. See RULE_CATEGORY_ORDER.
  const grouped = RULE_CATEGORY_ORDER.map((category) => ({
    category,
    rules: rules.filter((rule) => rule.category === category),
  })).filter((group) => group.rules.length > 0);

  return (
    <div className="space-y-8">
      {grouped.map((group) => (
        <section key={group.category}>
          <h2 className="mb-3 font-heading text-lg font-semibold text-ink">
            {copy.categories[group.category]}
          </h2>

          <div className="space-y-3">
            {group.rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                locale={locale}
                d={d}
                currency={currency}
                action={actions?.(rule)}
                showEnforcement={showEnforcement}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RuleRow({
  rule,
  locale,
  d,
  currency,
  action,
  showEnforcement,
}: {
  rule: RuleRecord;
  locale: Locale;
  d: DashboardDictionary;
  currency: string;
  action?: ReactNode;
  showEnforcement: boolean;
}) {
  const copy = d.rules;

  const value = formatRuleValue(rule.valueType, rule.value, {
    currency,
    units: {
      days: copy.units.days,
      months: copy.units.months,
      yes: copy.units.yes,
      no: copy.units.no,
    },
  });

  return (
    <article
      className={cn(
        "rounded-2xl border border-border bg-surface p-5 shadow-card",
        // A withdrawn rule stays readable but is visibly no longer in force.
        // Removing it would strand anybody looking up the rule they were
        // fined under last year.
        !rule.isActive && "border-dashed opacity-70"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "font-heading text-base font-semibold text-ink",
              !rule.isActive && "line-through decoration-ink-muted/60"
            )}
          >
            {locale === "rw" ? rule.title.rw : rule.title.en}
          </h3>

          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            {locale === "rw" ? rule.body.rw : rule.body.en}
          </p>
        </div>

        {/* The figure, given the visual weight it has in the member's life. */}
        {value && (
          <p className="shrink-0 rounded-xl bg-primary-50 px-3 py-1.5 font-heading text-lg font-bold tabular-nums text-primary">
            {value}
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
        {showEnforcement && <EnforcementBadge rule={rule} d={d} />}

        {!rule.isActive && (
          <span className="font-semibold uppercase tracking-wide text-amber-700">
            {copy.member.withdrawn}
          </span>
        )}

        <span>
          {fill(copy.member.lastChanged, {
            date: formatDate(rule.updatedAt, locale),
          })}
        </span>

        {rule.version > 1 && (
          <span>{fill(copy.member.version, { version: rule.version })}</span>
        )}

        {action && <span className="ml-auto flex items-center gap-2">{action}</span>}
      </div>
    </article>
  );
}

/**
 * Which rules the software applies by itself.
 *
 * Shown to members, not only to officers. A fine that appears overnight and a
 * limit an officer chose to apply are different kinds of decision, and a member
 * arguing about one needs to know which they are arguing about.
 */
function EnforcementBadge({
  rule,
  d,
}: {
  rule: RuleRecord;
  d: DashboardDictionary;
}) {
  const copy = d.rules.enforcement;

  const style = {
    AUTOMATIC: {
      icon: CircleCheck,
      label: copy.AUTOMATIC,
      hint: copy.automaticHint,
      className: "text-primary",
    },
    ASSISTED: {
      icon: Hand,
      label: copy.ASSISTED,
      hint: copy.assistedHint,
      className: "text-amber-700",
    },
    INFORMATIONAL: {
      icon: ScrollText,
      label: copy.INFORMATIONAL,
      hint: copy.informationalHint,
      className: "text-ink-muted",
    },
  }[rule.enforcement];

  const Icon = style.icon;

  return (
    <span
      className={cn("flex items-center gap-1.5 font-medium", style.className)}
      title={style.hint}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {style.label}
    </span>
  );
}
