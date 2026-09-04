import { formatMoney, toMoney } from "@/lib/money";
import type { RuleValueType } from "@/lib/generated/prisma/enums";

/**
 * Rendering a rule's value the way a person would say it.
 *
 * "7%" and "7 days" and "RWF 1,000" are all stored as the string "7" or
 * "1000.00", and the difference is the rule's type. Doing this in one place
 * means the member's page, the committee's rulebook and the edit dialog cannot
 * render the same figure three different ways — which they did, in the first
 * draft of this feature, and it made two rules look like they disagreed when
 * they did not.
 *
 * Trailing zeros are trimmed on percentages: the column stores 7.0000 and no
 * member has ever wanted to read "7.0000%".
 */
export function formatRuleValue(
  valueType: RuleValueType,
  value: string | null,
  options: {
    currency?: string;
    /// Words for the units, from the dictionary, so this stays translatable.
    units: { days: string; months: string; yes: string; no: string };
  }
): string {
  if (value === null || value === "") return "—";

  switch (valueType) {
    case "MONEY":
      return formatMoney(value, { currency: options.currency ?? "RWF" });

    case "PERCENT":
      return `${trimZeros(value)}%`;

    case "DAYS":
      return `${value} ${options.units.days}`;

    case "MONTHS":
      return `${value} ${options.units.months}`;

    case "COUNT":
      return value;

    case "BOOLEAN":
      return value === "true" ? options.units.yes : options.units.no;

    case "TEXT":
    default:
      return "";
  }
}

/**
 * The bare number for an input field.
 *
 * An edit dialog must show "7", not "7%": the field is re-submitted verbatim,
 * and round-tripping the display form would either fail validation or, worse,
 * be stripped silently and look like it worked.
 */
export function ruleInputValue(valueType: RuleValueType, value: string | null): string {
  if (value === null) return "";
  if (valueType === "PERCENT" || valueType === "MONEY") return trimZeros(value);
  return value;
}

/** 7.0000 → 7, 2.5000 → 2.5, 1000.00 → 1000. */
function trimZeros(value: string): string {
  try {
    return toMoney(value).toDecimalPlaces(4).toString();
  } catch {
    return value;
  }
}
