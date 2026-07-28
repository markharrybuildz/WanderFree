import type { UserVisibleBenefit } from "@/lib/types";

import {
  benefitValue,
  benefitValueLabel,
  fmtDate,
  fmtMonthDay,
  formatProgramAmount,
  humanize,
  localIsoDay,
  programUnitLabel,
  resetSuffix,
  splitNameValue,
  usd,
  usdCents,
} from "./format";

// Minimal builder — casts a partial to the full type; the formatters only read
// the fields we set here.
const benefit = (b: Partial<UserVisibleBenefit>): UserVisibleBenefit =>
  b as UserVisibleBenefit;

describe("usd", () => {
  it("rounds to whole dollars with thousands separators", () => {
    expect(usd(1200)).toBe("$1,200");
    expect(usd(1200.4)).toBe("$1,200");
    expect(usd(1200.5)).toBe("$1,201");
    expect(usd(0)).toBe("$0");
  });
});

describe("usdCents", () => {
  it("always shows two decimals with thousands separators", () => {
    expect(usdCents(1200)).toBe("$1,200.00");
    expect(usdCents(1200.4)).toBe("$1,200.40");
    expect(usdCents(8)).toBe("$8.00");
    expect(usdCents(10.999)).toBe("$11.00"); // rounds to 2 places
  });
});

describe("splitNameValue", () => {
  it("splits a leading dollar amount off the name", () => {
    expect(
      splitNameValue({
        name: "$120 Peloton Membership Credit",
        annual_value: null,
        value_per_period: null,
      }),
    ).toEqual({ title: "Peloton Membership Credit", value: 120 });
  });

  it("handles comma-grouped amounts", () => {
    expect(
      splitNameValue({
        name: "$1,200 Travel Credit",
        annual_value: null,
        value_per_period: null,
      }),
    ).toEqual({ title: "Travel Credit", value: 1200 });
  });

  it("falls back to annual_value then value_per_period when no leading $", () => {
    expect(
      splitNameValue({
        name: "Priority Pass",
        annual_value: 429,
        value_per_period: null,
      }),
    ).toEqual({ title: "Priority Pass", value: 429 });
    expect(
      splitNameValue({
        name: "Priority Pass",
        annual_value: null,
        value_per_period: 35,
      }),
    ).toEqual({ title: "Priority Pass", value: 35 });
  });
});

describe("benefitValue", () => {
  it("prefers cycle allotment over value_per_period over annual over name", () => {
    expect(
      benefitValue(
        benefit({
          name: "$300 Travel Credit",
          annual_value: 300,
          value_per_period: 25,
          cycle: { allotted_value: 30 } as UserVisibleBenefit["cycle"],
        }),
      ),
    ).toBe(30);
    expect(
      benefitValue(
        benefit({
          name: "$300 Travel Credit",
          annual_value: 300,
          value_per_period: 25,
          cycle: null,
        }),
      ),
    ).toBe(25);
    expect(
      benefitValue(
        benefit({
          name: "$300 Travel Credit",
          annual_value: 300,
          value_per_period: null,
          cycle: null,
        }),
      ),
    ).toBe(300);
    expect(
      benefitValue(
        benefit({
          name: "$300 Travel Credit",
          annual_value: null,
          value_per_period: null,
          cycle: null,
        }),
      ),
    ).toBe(300);
  });
});

describe("resetSuffix", () => {
  it("maps frequencies to short suffixes", () => {
    expect(resetSuffix("monthly")).toBe("/mo");
    expect(resetSuffix("quarterly")).toBe("/qtr");
    expect(resetSuffix("semiannual")).toBe("/6mo");
    expect(resetSuffix("annual")).toBe("/yr");
    expect(resetSuffix("one_time")).toBe("");
  });
});

describe("benefitValueLabel", () => {
  it("suffixes a per-cycle amount with the reset frequency", () => {
    expect(
      benefitValueLabel(
        benefit({
          reset_frequency: "monthly",
          value_per_period: 10,
          annual_value: 120,
          cycle: null,
        }),
      ),
    ).toBe("$10/mo");
  });

  it("labels an annual-only value with /yr", () => {
    expect(
      benefitValueLabel(
        benefit({
          reset_frequency: "annual",
          value_per_period: null,
          annual_value: 300,
          cycle: null,
        }),
      ),
    ).toBe("$300/yr");
  });

  it("returns null for a perk with no value", () => {
    expect(
      benefitValueLabel(
        benefit({
          name: "Lounge Access",
          reset_frequency: "annual",
          value_per_period: null,
          annual_value: null,
          cycle: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("formatProgramAmount", () => {
  it("keeps cents for cash_back but drops them for whole amounts", () => {
    expect(formatProgramAmount(210.55, "cash_back")).toBe("$210.55");
    expect(formatProgramAmount(200, "cash_back")).toBe("$200");
  });

  it("rounds points and miles and labels the unit", () => {
    expect(formatProgramAmount(60000, "points")).toBe("60,000 pts");
    expect(formatProgramAmount(12500.4, "miles")).toBe("12,500 miles");
    expect(formatProgramAmount(1000, null)).toBe("1,000 pts");
  });
});

describe("programUnitLabel", () => {
  it("maps unit types to short labels", () => {
    expect(programUnitLabel("cash_back")).toBe("$");
    expect(programUnitLabel("miles")).toBe("miles");
    expect(programUnitLabel("points")).toBe("pts");
    expect(programUnitLabel(null)).toBe("pts");
  });
});

describe("localIsoDay", () => {
  it("formats local calendar parts, zero-padded", () => {
    expect(localIsoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localIsoDay(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("fmtDate / fmtMonthDay", () => {
  // Regression: Postgres `date` strings parse as UTC midnight. Formatting must
  // pin timeZone to UTC or the calendar day shifts back one in US timezones.
  it("does not shift the day for a UTC-midnight date string", () => {
    expect(fmtDate("2026-07-07")).toBe("Jul 7, 2026");
    expect(fmtMonthDay("2026-08-01")).toBe("Aug 1");
  });
});

describe("humanize", () => {
  it("turns enum_value into Title Case and handles null", () => {
    expect(humanize("partially_used")).toBe("Partially Used");
    expect(humanize(null)).toBe("—");
    expect(humanize(undefined)).toBe("—");
  });
});
