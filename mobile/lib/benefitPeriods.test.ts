import {
  computeAnniversaryPeriod,
  computeCalendarPeriod,
  iso,
} from "./benefitPeriods";

// Dates are built with new Date(year, monthIndex, day) — local midnight — and
// the suite runs under TZ=America/Los_Angeles (see the test script), so iso()'s
// UTC conversion of a negative-offset local midnight stays on the same calendar
// day. This is exactly the timezone that would expose an off-by-one bug.

describe("computeCalendarPeriod", () => {
  it("annual → the whole calendar year", () => {
    expect(computeCalendarPeriod(new Date(2026, 5, 15), "annual")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("semiannual → H1 for the first half, H2 for the second", () => {
    expect(computeCalendarPeriod(new Date(2026, 2, 15), "semiannual")).toEqual({
      start: "2026-01-01",
      end: "2026-06-30",
    });
    expect(computeCalendarPeriod(new Date(2026, 7, 15), "semiannual")).toEqual({
      start: "2026-07-01",
      end: "2026-12-31",
    });
  });

  it("quarterly → the calendar quarter containing today", () => {
    expect(computeCalendarPeriod(new Date(2026, 7, 15), "quarterly")).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
  });

  it("monthly → the calendar month, incl. correct last day", () => {
    expect(computeCalendarPeriod(new Date(2026, 7, 15), "monthly")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    // February in a non-leap year ends on the 28th.
    expect(computeCalendarPeriod(new Date(2026, 1, 10), "monthly")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("one_time → opens today, effectively never resets", () => {
    expect(computeCalendarPeriod(new Date(2026, 5, 15), "one_time")).toEqual({
      start: "2026-06-15",
      end: "2126-12-31",
    });
  });
});

describe("computeAnniversaryPeriod", () => {
  it("annual → the anniversary window containing today", () => {
    // Opened 2024-03-10; the 2026-03-10 → 2027-03-09 window contains 2026-07-15.
    expect(
      computeAnniversaryPeriod(
        new Date(2026, 6, 15),
        new Date(2024, 2, 10),
        "annual",
      ),
    ).toEqual({ start: "2026-03-10", end: "2027-03-09" });
  });

  it("monthly → the current month-since-anniversary window", () => {
    // Opened on the 20th; on 2026-07-15 the live window is 06-20 → 07-19.
    expect(
      computeAnniversaryPeriod(
        new Date(2026, 6, 15),
        new Date(2026, 0, 20),
        "monthly",
      ),
    ).toEqual({ start: "2026-06-20", end: "2026-07-19" });
  });

  it("one_time → opens at openedOn, effectively never resets", () => {
    expect(
      computeAnniversaryPeriod(
        new Date(2026, 6, 15),
        new Date(2025, 4, 1),
        "one_time",
      ),
    ).toEqual({ start: "2025-05-01", end: "2125-12-31" });
  });

  it("always yields a window that actually contains today", () => {
    const today = new Date(2026, 8, 3);
    for (const freq of ["annual", "semiannual", "quarterly", "monthly"] as const) {
      const { start, end } = computeAnniversaryPeriod(
        today,
        new Date(2023, 10, 27),
        freq,
      );
      const t = iso(today);
      expect(start <= t).toBe(true);
      expect(t <= end).toBe(true);
    }
  });
});
