// Shared formatting + benefit-value helpers, used across the benefit and card
// screens so the logic (esp. how a benefit's headline value is parsed) lives
// in exactly one place.

import { type ResetFrequency, type UserVisibleBenefit } from "@/lib/types";

/** Round to whole dollars with thousands separators, e.g. "$1,200". */
export function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Catalog benefit names embed the headline value, e.g.
 * "$120 Peloton Membership Credit". Split that leading amount off so the title
 * is clean text and the value can be shown once. Falls back to annual_value /
 * value_per_period when the name has no leading "$".
 */
export function splitNameValue(
  b: Pick<UserVisibleBenefit, "name" | "annual_value" | "value_per_period">,
): { title: string; value: number | null } {
  const m = b.name.match(/^\$\s?([\d,]+(?:\.\d+)?)\s+(.+)$/);
  if (m) return { title: m[2].trim(), value: parseFloat(m[1].replace(/,/g, "")) };
  return { title: b.name, value: b.annual_value ?? b.value_per_period ?? null };
}

/**
 * The single canonical dollar figure for a benefit: the amount you can redeem
 * in the current cycle, preferred over the annual total, so the number shown
 * in the list matches the redemption tracker and the summary totals. Falls
 * back through value_per_period, annual_value, then any amount embedded in the
 * name. Use this everywhere a benefit needs one headline number.
 */
export function benefitValue(
  b: Pick<
    UserVisibleBenefit,
    "name" | "annual_value" | "value_per_period" | "cycle"
  >,
): number | null {
  return (
    b.cycle?.allotted_value ??
    b.value_per_period ??
    b.annual_value ??
    splitNameValue(b).value
  );
}

const RESET_SUFFIX: Record<ResetFrequency, string> = {
  monthly: "/mo",
  quarterly: "/qtr",
  semiannual: "/6mo",
  annual: "/yr",
  one_time: "",
};

/** Short per-period suffix for a benefit value, e.g. "/mo". "" for one-time. */
export function resetSuffix(f: ResetFrequency): string {
  return RESET_SUFFIX[f] ?? "";
}

/**
 * Display string for a benefit's headline value, with a period suffix so a
 * small per-cycle figure never reads as an annual total. Per-cycle amounts get
 * the reset-frequency suffix (e.g. "$10/mo"); an annual-only value gets "/yr";
 * a name-embedded amount gets no suffix. Returns null for a perk (no value),
 * which callers render as "Perk".
 */
export function benefitValueLabel(b: UserVisibleBenefit): string | null {
  const perCycle = b.cycle?.allotted_value ?? b.value_per_period ?? null;
  if (perCycle != null) return usd(perCycle) + resetSuffix(b.reset_frequency);
  if (b.annual_value != null) return `${usd(b.annual_value)}/yr`;
  const named = splitNameValue(b).value;
  return named != null ? usd(named) : null;
}

/** Format a rewards amount in its program's native unit: "60,000 pts",
 *  "12,500 miles", or "$200" for cash-back programs. Falls back to "pts"
 *  when the unit is unknown. */
export function formatProgramAmount(
  value: number,
  unitType?: string | null,
): string {
  if (unitType === "cash_back") {
    // Keep cents for cash balances ($210.55 must not read as $211).
    return `$${value.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    })}`;
  }
  const n = Math.round(value).toLocaleString();
  return `${n} ${unitType === "miles" ? "miles" : "pts"}`;
}

/** Short label for a program unit, for form-field hints: "pts", "miles", "$". */
export function programUnitLabel(unitType?: string | null): string {
  if (unitType === "cash_back") return "$";
  return unitType === "miles" ? "miles" : "pts";
}

/** Local-calendar "YYYY-MM-DD" for `d` (defaults to now). Never go through
 *  toISOString() for this — it converts to UTC first, which shifts the
 *  calendar day for negative-offset timezones (all of the US) in the
 *  evening. */
export function localIsoDay(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Benefit cycle period_start/period_end are Postgres `date` columns ("YYYY-MM-DD"),
// which parse as UTC midnight. Formatting must pin timeZone to UTC or the calendar
// date shifts a day back for users in negative-offset zones (e.g. all of the US).

/** Short date, e.g. "Jul 7, 2026". */
export function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Month + day only, e.g. "Aug 1". */
export function fmtMonthDay(s: string): string {
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** enum_value -> "Enum Value". */
export function humanize(s?: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
