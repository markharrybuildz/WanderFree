// TypeScript shapes mirroring the Postgres schema in
// `supabase/migrations/0001_init.sql`. When the DB schema changes, update
// these to match. (Long term we'd want to generate this with
// `supabase gen types typescript` — punting that for v1.)

// ── Catalog ──────────────────────────────────────────────────────────────

export interface Issuer {
  id: number;
  slug: string;
  name: string;
}

export interface NetworkTier {
  id: number;
  slug: string;
  network: "visa" | "mastercard" | "amex" | "discover";
  tier_name: string;
}

export interface Card {
  id: number;
  slug: string;
  name: string;
  issuer_id: number;
  network_tier_id: number | null;
  annual_fee_cents: number | null;
  is_business: boolean;
  is_active: boolean;
  // Joined when we ask for it
  issuer?: Issuer;
  network_tier?: NetworkTier | null;
}

// ── Per-user ─────────────────────────────────────────────────────────────

export interface UserCard {
  user_id: string;
  card_id: number;
  opened_on: string | null;
  created_at: string;
  card?: Card;
}

export interface UserBenefit {
  user_id: string;
  benefit_id: number;
  completed: boolean;
  completed_at: string | null;
  notes: string | null;
  updated_at: string;
}

// ── Read view ────────────────────────────────────────────────────────────

// Mirrors the SELECT list of `user_visible_benefits`. Columns from the
// per-user join (completed, completed_at) are merged in.
export interface UserVisibleBenefit {
  benefit_id: number;
  source: "card" | "network";
  card_id: number | null;
  network_tier_id: number | null;
  card_name: string | null;
  issuer_name: string | null;

  category: BenefitCategory;
  subcategory: string | null;

  reward_type: RewardType;
  reward_value: number | null;
  reward_value_unit: RewardValueUnit | null;

  cap_amount_cents: number | null;
  cap_period: CapPeriod | null;
  min_spend_cents: number | null;
  min_spend_period_months: number | null;

  recurrence: Recurrence;
  recurrence_split: boolean;
  valid_from: string | null;
  valid_to: string | null;

  requires_activation: boolean;
  activation_method: string | null;
  eligible_merchants: string[] | null;

  source_quote: string;
  source_url: string | null;
  source_section: string | null;
  extraction_confidence: "high" | "medium" | "low";
  notes: string | null;

  completed: boolean;
  completed_at: string | null;
}

// ── Enums (kept in sync with pipeline/src/extract/schema.py) ─────────────

export type BenefitCategory =
  | "dining"
  | "travel"
  | "flights"
  | "hotels"
  | "gas"
  | "ev_charging"
  | "grocery"
  | "wholesale_club"
  | "transit"
  | "rideshare"
  | "streaming"
  | "telecom"
  | "online_retail"
  | "drugstore"
  | "lounge_access"
  | "global_entry_credit"
  | "tsa_precheck_credit"
  | "travel_insurance"
  | "purchase_protection"
  | "extended_warranty"
  | "rental_car_cdw"
  | "trip_delay"
  | "trip_cancellation"
  | "lost_luggage"
  | "cell_phone_protection"
  | "statement_credit_brand"
  | "statement_credit_general"
  | "signup_bonus"
  | "anniversary_bonus"
  | "referral_bonus"
  | "points_transfer_partner"
  | "redemption_bonus"
  | "other";

export type RewardType =
  | "points_multiplier"
  | "cash_back_pct"
  | "statement_credit"
  | "fixed_points"
  | "perk"
  | "insurance"
  | "discount_pct";

export type RewardValueUnit =
  | "points_per_dollar"
  | "miles_per_dollar"
  | "percentage"
  | "points"
  | "miles"
  | "cents_usd"
  | "none";

export type CapPeriod = "per_month" | "per_quarter" | "per_year" | "lifetime" | "none";

export type Recurrence =
  | "one_time"
  | "monthly"
  | "quarterly"
  | "semi_annual"
  | "annual"
  | "ongoing"
  | "limited_time";

// ── Helpers for UI display ───────────────────────────────────────────────

/** Group benefits the way the Figma's filter dropdowns expect. */
export const SPEND_CATEGORIES: BenefitCategory[] = [
  "dining",
  "travel",
  "flights",
  "hotels",
  "gas",
  "grocery",
  "transit",
  "rideshare",
  "streaming",
];

/** Format a benefit's reward into a human display string. Pure function — easy to test. */
export function formatReward(b: Pick<UserVisibleBenefit, "reward_type" | "reward_value" | "reward_value_unit">): string {
  if (b.reward_value == null) return "";
  switch (b.reward_type) {
    case "points_multiplier":
      return `${b.reward_value}x`;
    case "cash_back_pct":
    case "discount_pct":
      return `${(b.reward_value * 100).toFixed(b.reward_value < 0.01 ? 2 : 0)}%`;
    case "statement_credit":
      return `$${(b.reward_value / 100).toLocaleString()}`;
    case "fixed_points":
      return `${b.reward_value.toLocaleString()} pts`;
    default:
      return "";
  }
}
