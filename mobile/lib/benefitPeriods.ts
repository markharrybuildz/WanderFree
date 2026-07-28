// Benefit-cycle period math. Pure date helpers, extracted from lib/hooks.ts so
// they can be unit-tested without pulling in the Supabase client (which throws
// at import time when the EXPO_PUBLIC_* env vars are absent, e.g. under Jest).

import { type ResetFrequency } from "@/lib/types";

/** UTC "YYYY-MM-DD" for a Date. */
export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Compute the anniversary-basis period that contains `today`, anchored at
 *  `openedOn`. Returns ISO date strings (YYYY-MM-DD). */
export function computeAnniversaryPeriod(
  today: Date,
  openedOn: Date,
  freq: ResetFrequency,
): { start: string; end: string } {
  // Step interval in months for each frequency.
  const months: Record<Exclude<ResetFrequency, "one_time">, number> = {
    annual: 12,
    semiannual: 6,
    quarterly: 3,
    monthly: 1,
  };
  if (freq === "one_time") {
    return { start: iso(openedOn), end: `${openedOn.getFullYear() + 100}-12-31` };
  }
  const step = months[freq];

  // Roll the anchor forward in `step`-month increments until it just
  // exceeds today, then back off one step to get the current period start.
  const start = new Date(openedOn);
  while (start <= today) {
    start.setMonth(start.getMonth() + step);
  }
  start.setMonth(start.getMonth() - step);

  const end = new Date(start);
  end.setMonth(end.getMonth() + step);
  end.setDate(end.getDate() - 1);

  return { start: iso(start), end: iso(end) };
}

/** Compute the calendar-basis period that contains `today` for the given
 *  reset frequency. Returns ISO date strings (YYYY-MM-DD). */
export function computeCalendarPeriod(
  today: Date,
  freq: ResetFrequency,
): { start: string; end: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (freq) {
    case "annual":
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case "semiannual": {
      const startMonth = m < 6 ? 0 : 6;
      const endMonth = m < 6 ? 5 : 11;
      return {
        start: iso(new Date(y, startMonth, 1)),
        end: iso(new Date(y, endMonth + 1, 0)),
      };
    }
    case "quarterly": {
      const startMonth = Math.floor(m / 3) * 3;
      return {
        start: iso(new Date(y, startMonth, 1)),
        end: iso(new Date(y, startMonth + 3, 0)),
      };
    }
    case "monthly":
      return {
        start: iso(new Date(y, m, 1)),
        end: iso(new Date(y, m + 1, 0)),
      };
    case "one_time":
      return { start: iso(today), end: `${y + 100}-12-31` };
  }
}
