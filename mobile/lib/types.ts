// TypeScript shapes mirroring the Postgres schema in
// `supabase/migrations/`. Regenerate with `supabase gen types typescript`
// once we wire that into the dev loop; until then keep these in sync by
// hand after each `supabase db pull`.

// ── Enums (match live Postgres enums) ────────────────────────────────────

export type CardNetwork = "visa" | "mastercard" | "amex" | "discover";

export type RewardUnit = "points" | "miles" | "cash_back";

export type ProgramUnitType = "points" | "miles" | "cash_back";

export type ResetFrequency =
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "one_time";

export type ResetBasis = "calendar" | "anniversary";

export type BenefitCycleStatus =
  | "unused"
  | "partially_used"
  | "fully_used"
  | "expired";

export type MemberRole = "owner" | "editor" | "viewer";

export type TransferPartnerType = "airline" | "hotel";

// ── Catalog (public-read) ────────────────────────────────────────────────

export interface CardIssuer {
  id: string;
  name: string;
}

export interface RewardsProgram {
  id: string;
  name: string;
  unit_type: ProgramUnitType;
  created_at: string;
  updated_at: string;
}

export interface CardProduct {
  id: string;
  issuer_id: string;
  rewards_program_id: string | null;
  name: string;
  network: CardNetwork;
  annual_fee: number;
  // Joined when requested
  issuer?: CardIssuer;
  rewards_program?: RewardsProgram | null;
}

export interface RewardCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface BenefitCategory {
  id: string;
  name: string;
  description: string | null;
}

export interface CardRewardRule {
  id: string;
  card_product_id: string;
  reward_category_id: string;
  multiplier: number;
  reward_unit: RewardUnit;
  days_of_week: number[] | null;
  start_time: string | null;
  end_time: string | null;
  spend_cap: number | null;
  conditions: Record<string, unknown> | null;
  reward_category?: RewardCategory;
}

export interface BenefitDefinition {
  id: string;
  card_product_id: string;
  benefit_category_id: string | null;
  name: string;
  value_per_period: number | null;
  annual_value: number | null;
  reset_frequency: ResetFrequency;
  reset_basis: ResetBasis;
  requires_enrollment: boolean;
  benefit_category?: BenefitCategory | null;
}

export interface TransferPartner {
  id: string;
  name: string;
  partner_type: TransferPartnerType;
}

export interface ProgramTransferPartner {
  id: string;
  rewards_program_id: string;
  transfer_partner_id: string;
  transfer_ratio: number;
  is_active: boolean;
  transfer_partner?: TransferPartner;
}

// ── Per-portfolio (RLS-gated) ────────────────────────────────────────────

export interface Profile {
  id: string;
  display_name: string | null;
}

export interface Portfolio {
  id: string;
  name: string;
  type: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PortfolioMember {
  id: string;
  portfolio_id: string;
  profile_id: string;
  role: MemberRole;
  profile?: Profile;
}

export interface WalletAccount {
  id: string;
  portfolio_id: string;
  rewards_program_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
  rewards_program?: RewardsProgram;
}

export interface UserCard {
  id: string;
  portfolio_id: string;
  card_product_id: string;
  nickname: string | null;
  last_four: string | null;
  opened_on: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  card_product?: CardProduct;
}

export interface UserSignupBonus {
  id: string;
  user_card_id: string;
  required_spend: number;
  spend_deadline: string;
  bonus_value: number;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface SpendEntry {
  id: string;
  user_card_id: string;
  signup_bonus_id: string | null;
  amount: number;
  spent_on: string;
  reward_category_id: string;
  created_at: string;
  updated_at: string;
  reward_category?: RewardCategory;
}

export interface UserBenefitCycle {
  id: string;
  user_card_id: string;
  benefit_definition_id: string;
  period_start: string;
  period_end: string;
  allotted_value: number | null;
  status: BenefitCycleStatus;
  created_at: string;
  updated_at: string;
  benefit_definition?: BenefitDefinition;
}

export interface BenefitRedemption {
  id: string;
  benefit_cycle_id: string;
  user_card_id: string;
  benefit_definition_id: string;
  amount: number;
  redeemed_on: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ── UI convenience ───────────────────────────────────────────────────────

/** A benefit definition resolved against a user_card and (optionally) its
 *  current cycle. This is the row shape the Benefits screen consumes. */
export interface UserVisibleBenefit {
  user_card_id: string;
  benefit_definition_id: string;
  name: string;
  card_name: string;
  value_per_period: number | null;
  annual_value: number | null;
  reset_frequency: ResetFrequency;
  benefit_category?: BenefitCategory | null;
  cycle: UserBenefitCycle | null;
  redeemed_amount: number;
  fully_redeemed: boolean;
}

/** Format a benefit's per-period value as a USD string. */
export function formatBenefitValue(b: Pick<BenefitDefinition, "value_per_period">): string {
  if (b.value_per_period == null) return "";
  return `$${b.value_per_period.toLocaleString()}`;
}
