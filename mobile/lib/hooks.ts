// Data hooks for screens.
//
// Convention: one hook per query/mutation. Pages compose them; no business
// logic lives in the screen components themselves.
//
// Portfolio model: all per-user data hangs off a portfolio (which can be
// shared between profiles via `portfolio_members`). For v1 the UI assumes a
// single "current portfolio" — the first one the signed-in user belongs to.
// Multi-portfolio switching can be layered on later without changing the
// hook signatures below (they already accept portfolioId).
//
// Cache keys:
//   ["card_products"]                 catalog (public read)
//   ["current_portfolio"]             { id } for the signed-in user
//   ["portfolio", id, "user_cards"]   cards held in a portfolio
//   ["portfolio", id, "benefits"]     benefits across all cards in a portfolio
//   ["portfolio", id, "wallets"]      points/cash balances per program

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "./supabase";
import type {
  CardProduct,
  Portfolio,
  ResetFrequency,
  UserBenefitCycle,
  UserCard,
  UserVisibleBenefit,
  WalletAccount,
} from "./types";

const SELECTED_PORTFOLIO_KEY = "wanderfree-selected-portfolio-id";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Compute the anniversary-basis period that contains `today`, anchored at
 *  `openedOn`. Returns ISO date strings (YYYY-MM-DD). */
function computeAnniversaryPeriod(
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
function computeCalendarPeriod(
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

// ── Catalog (everyone sees the same) ─────────────────────────────────────

export function useCardProducts() {
  return useQuery({
    queryKey: ["card_products"],
    queryFn: async (): Promise<CardProduct[]> => {
      const { data, error } = await supabase
        .from("card_products")
        .select("*, issuer:card_issuers(*), rewards_program:rewards_programs(*)")
        .order("name");
      if (error) throw error;
      return (data as CardProduct[]) ?? [];
    },
    // Catalog is hand-curated and rarely changes.
    staleTime: 1000 * 60 * 60 * 24,
  });
}

// ── Portfolio resolution ─────────────────────────────────────────────────

/** All portfolios the signed-in user belongs to, sorted by creation time
 *  for stable ordering. */
export function useUserPortfolios() {
  return useQuery({
    queryKey: ["user_portfolios"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<Portfolio[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("portfolio_members")
        .select("portfolio:portfolios(*)")
        .eq("profile_id", user.id);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ portfolio: Portfolio | null }>;
      const portfolios = rows
        .map((r) => r.portfolio)
        .filter((p): p is Portfolio => p != null);
      portfolios.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return portfolios;
    },
  });
}

/** Resolve the active portfolio. Honors the user's stored selection (set
 *  via useSetCurrentPortfolio); falls back to the oldest portfolio they
 *  belong to.
 *
 *  This query is user-scoped but the key doesn't include user.id, so we
 *  refetch on every mount instead of trusting the persisted cache (which
 *  may hold a `null` from a previous unauthenticated render). The auth
 *  listener in `lib/auth.ts` also invalidates this key on sign-in/sign-out. */
export function useCurrentPortfolio() {
  return useQuery({
    queryKey: ["current_portfolio"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async (): Promise<Portfolio | null> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("portfolio_members")
        .select("portfolio:portfolios(*)")
        .eq("profile_id", user.id);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{ portfolio: Portfolio | null }>;
      const portfolios = rows
        .map((r) => r.portfolio)
        .filter((p): p is Portfolio => p != null);
      if (portfolios.length === 0) return null;
      portfolios.sort((a, b) => a.created_at.localeCompare(b.created_at));

      const storedId = await AsyncStorage.getItem(SELECTED_PORTFOLIO_KEY);
      if (storedId) {
        const found = portfolios.find((p) => p.id === storedId);
        if (found) return found;
      }
      return portfolios[0];
    },
  });
}

// ── Per-portfolio reads ──────────────────────────────────────────────────

/** Cards held in the given portfolio, with the card_product/issuer joined. */
export function useUserCards(portfolioId: string | undefined) {
  return useQuery({
    enabled: !!portfolioId,
    queryKey: ["portfolio", portfolioId, "user_cards"],
    queryFn: async (): Promise<UserCard[]> => {
      const { data, error } = await supabase
        .from("user_cards")
        .select(
          "*, card_product:card_products(*, issuer:card_issuers(*), rewards_program:rewards_programs(*))",
        )
        .eq("portfolio_id", portfolioId!)
        .eq("is_active", true);
      if (error) throw error;
      return (data as UserCard[]) ?? [];
    },
  });
}

/** Wallet balances (per rewards program) for the given portfolio. */
export function useWalletAccounts(portfolioId: string | undefined) {
  return useQuery({
    enabled: !!portfolioId,
    queryKey: ["portfolio", portfolioId, "wallets"],
    queryFn: async (): Promise<WalletAccount[]> => {
      const { data, error } = await supabase
        .from("wallet_accounts")
        .select("*, rewards_program:rewards_programs(*)")
        .eq("portfolio_id", portfolioId!);
      if (error) throw error;
      return (data as WalletAccount[]) ?? [];
    },
  });
}

/**
 * Benefits visible to the user: every benefit_definition attached to a card
 * in their portfolio, joined with the currently-active user_benefit_cycle
 * (if one exists) and the running redemption total for that cycle.
 *
 * This is the closest analogue to the old `user_visible_benefits` view —
 * but computed client-side because the new schema doesn't ship an
 * equivalent. If this becomes hot we'll push it back into a Postgres view.
 */
export function useBenefits(portfolioId: string | undefined) {
  return useQuery({
    enabled: !!portfolioId,
    queryKey: ["portfolio", portfolioId, "benefits"],
    queryFn: async (): Promise<UserVisibleBenefit[]> => {
      // Pull the user's active cards together with each card_product's
      // benefit_definitions and any open benefit cycles + redemptions.
      const { data, error } = await supabase
        .from("user_cards")
        .select(
          `
          id,
          nickname,
          card_product:card_products(
            id,
            name,
            benefit_definitions(
              id,
              name,
              value_per_period,
              annual_value,
              reset_frequency,
              benefit_category:benefit_categories(*)
            )
          ),
          user_benefit_cycles(
            id,
            benefit_definition_id,
            period_start,
            period_end,
            allotted_value,
            status
          ),
          benefit_redemptions(
            id,
            benefit_definition_id,
            benefit_cycle_id,
            amount
          )
          `,
        )
        .eq("portfolio_id", portfolioId!)
        .eq("is_active", true);
      if (error) throw error;

      type BenefitDef = {
        id: string;
        name: string;
        value_per_period: number | null;
        annual_value: number | null;
        reset_frequency: UserVisibleBenefit["reset_frequency"];
        benefit_category: UserVisibleBenefit["benefit_category"];
      };
      type Row = {
        id: string;
        nickname: string | null;
        card_product: {
          id: string;
          name: string;
          benefit_definitions: BenefitDef[];
        } | null;
        user_benefit_cycles: UserBenefitCycle[];
        benefit_redemptions: Array<{
          id: string;
          benefit_definition_id: string;
          benefit_cycle_id: string;
          amount: number;
        }>;
      };

      const today = new Date().toISOString().slice(0, 10);
      const rows = (data as unknown as Row[]) ?? [];
      const out: UserVisibleBenefit[] = [];
      for (const card of rows) {
        const cardName = card.nickname ?? card.card_product?.name ?? "Card";
        for (const bd of card.card_product?.benefit_definitions ?? []) {
          // Current cycle = the one whose period contains today.
          const cycle =
            card.user_benefit_cycles.find(
              (c) =>
                c.benefit_definition_id === bd.id &&
                c.period_start <= today &&
                c.period_end >= today,
            ) ?? null;
          const redeemed = card.benefit_redemptions
            .filter((r) => r.benefit_definition_id === bd.id && (!cycle || r.benefit_cycle_id === cycle.id))
            .reduce((sum, r) => sum + Number(r.amount), 0);
          // No DB trigger maintains cycle.status today, so also derive
          // fully-redeemed from the running redemption sum. If a trigger
          // is added later this still does the right thing.
          const sumHit =
            cycle != null &&
            cycle.allotted_value != null &&
            redeemed >= Number(cycle.allotted_value);
          out.push({
            user_card_id: card.id,
            benefit_definition_id: bd.id,
            name: bd.name,
            card_name: cardName,
            value_per_period: bd.value_per_period == null ? null : Number(bd.value_per_period),
            annual_value: bd.annual_value == null ? null : Number(bd.annual_value),
            reset_frequency: bd.reset_frequency,
            benefit_category: bd.benefit_category,
            cycle,
            redeemed_amount: redeemed,
            fully_redeemed: cycle?.status === "fully_used" || sumHit,
          });
        }
      }
      return out;
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

/** Create a portfolio for the current user, add them as owner, and switch
 *  to it. Used by both the onboarding screen and the Settings switcher. */
export function useCreatePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<Portfolio> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: portfolio, error: pErr } = await supabase
        .from("portfolios")
        .insert({ name, type: "personal", created_by: user.id })
        .select()
        .single();
      if (pErr) throw pErr;

      const { error: mErr } = await supabase.from("portfolio_members").insert({
        portfolio_id: (portfolio as Portfolio).id,
        profile_id: user.id,
        role: "owner",
      });
      if (mErr) throw mErr;

      return portfolio as Portfolio;
    },
    onSuccess: async (newPortfolio) => {
      // Persist + select the new portfolio so the user lands on it.
      await AsyncStorage.setItem(SELECTED_PORTFOLIO_KEY, newPortfolio.id);
      qc.setQueryData(["current_portfolio"], newPortfolio);
      qc.invalidateQueries({ queryKey: ["user_portfolios"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

/** Delete a portfolio the user created. Cascades through wallet_accounts,
 *  user_cards, signup_bonuses, spend_entries, benefit_cycles, and
 *  benefit_redemptions via FK ON DELETE CASCADE. RLS only allows the
 *  creator to delete. */
export function useDeletePortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (portfolioId: string): Promise<string> => {
      const { error } = await supabase
        .from("portfolios")
        .delete()
        .eq("id", portfolioId);
      if (error) throw error;
      return portfolioId;
    },
    onSuccess: async (deletedId) => {
      // If the deleted portfolio was the active selection, clear it so
      // useCurrentPortfolio falls back to the next available (or null,
      // which triggers the onboarding screen).
      const storedId = await AsyncStorage.getItem(SELECTED_PORTFOLIO_KEY);
      if (storedId === deletedId) {
        await AsyncStorage.removeItem(SELECTED_PORTFOLIO_KEY);
      }
      qc.invalidateQueries({ queryKey: ["user_portfolios"] });
      qc.invalidateQueries({ queryKey: ["current_portfolio"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

/** Switch the active portfolio. Writes the selection to AsyncStorage,
 *  updates the current-portfolio cache, and invalidates all per-portfolio
 *  queries so Benefits / Cards / wallets refetch under the new id. */
export function useSetCurrentPortfolio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (portfolio: Portfolio): Promise<Portfolio> => {
      await AsyncStorage.setItem(SELECTED_PORTFOLIO_KEY, portfolio.id);
      return portfolio;
    },
    onSuccess: (portfolio) => {
      qc.setQueryData(["current_portfolio"], portfolio);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });
}

export function useAddUserCard(portfolioId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { cardProductId: string; openedOn: string | null }) => {
      if (!portfolioId) throw new Error("No portfolio selected");
      const { cardProductId, openedOn } = args;

      // 1. Create the user_card.
      const { data: card, error: cErr } = await supabase
        .from("user_cards")
        .insert({
          portfolio_id: portfolioId,
          card_product_id: cardProductId,
          opened_on: openedOn,
          is_active: true,
        })
        .select("id")
        .single();
      if (cErr) throw cErr;

      // 2. Look up the card_product's benefit_definitions and materialise
      //    the active cycle for each one. Without this the Benefits screen
      //    shows rows but they're not toggleable.
      const { data: defs, error: dErr } = await supabase
        .from("benefit_definitions")
        .select("id, value_per_period, annual_value, reset_frequency, reset_basis")
        .eq("card_product_id", cardProductId);
      if (dErr) throw dErr;

      const today = new Date();
      const openedOnDate = openedOn ? new Date(openedOn) : null;
      const cycles: Array<Record<string, unknown>> = [];
      for (const d of defs ?? []) {
        let period: { start: string; end: string } | null = null;
        if (d.reset_basis === "calendar") {
          period = computeCalendarPeriod(today, d.reset_frequency);
        } else if (d.reset_basis === "anniversary" && openedOnDate) {
          period = computeAnniversaryPeriod(today, openedOnDate, d.reset_frequency);
        }
        if (!period) continue; // anniversary benefit but no opened_on — skip
        cycles.push({
          user_card_id: (card as { id: string }).id,
          benefit_definition_id: d.id,
          period_start: period.start,
          period_end: period.end,
          allotted_value: d.value_per_period ?? d.annual_value ?? null,
          status: "unused",
        });
      }
      if (cycles.length > 0) {
        const { error: cyErr } = await supabase
          .from("user_benefit_cycles")
          .insert(cycles);
        if (cyErr) throw cyErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "user_cards"] });
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "benefits"] });
    },
  });
}

/** Update editable fields on a user_card.
 *  Note: changing opened_on does not retroactively recompute existing
 *  anniversary cycle periods — those stay as they were. Missing cycles
 *  for the new anchor will be materialised by useEnsureCycles on the
 *  next Benefits mount. */
export function useUpdateUserCard(portfolioId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      userCardId: string;
      patch: Partial<{
        nickname: string | null;
        last_four: string | null;
        opened_on: string | null;
      }>;
    }) => {
      const { error } = await supabase
        .from("user_cards")
        .update(args.patch)
        .eq("id", args.userCardId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "user_cards"] });
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "benefits"] });
      qc.invalidateQueries({ queryKey: ["card", vars.userCardId] });
    },
  });
}

/** Full card view — joined card_product (with issuer + rewards_program),
 *  all the card_product's benefit_definitions (with category), every
 *  user_benefit_cycle for this card, and every benefit_redemption. Used by
 *  the Card details screen. */
export function useCardDetails(userCardId: string | undefined) {
  return useQuery({
    enabled: !!userCardId,
    queryKey: ["card", userCardId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_cards")
        .select(
          `
          id, nickname, last_four, opened_on, is_active, created_at, portfolio_id,
          card_product:card_products(
            id, name, network, annual_fee,
            issuer:card_issuers(id, name),
            rewards_program:rewards_programs(id, name, unit_type),
            benefit_definitions(
              id, name, value_per_period, annual_value, reset_frequency, reset_basis, requires_enrollment,
              benefit_category:benefit_categories(id, name)
            )
          ),
          user_benefit_cycles(
            id, benefit_definition_id, period_start, period_end, allotted_value, status
          ),
          benefit_redemptions(
            id, benefit_definition_id, benefit_cycle_id, amount, redeemed_on, notes
          )
          `,
        )
        .eq("id", userCardId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useRemoveUserCard(portfolioId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userCardId: string) => {
      const { error } = await supabase
        .from("user_cards")
        .delete()
        .eq("id", userCardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "user_cards"] });
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "benefits"] });
    },
  });
}

/**
 * For every active user_card in the portfolio, make sure a cycle exists
 * for the period containing today (creating it if not), and mark any
 * fully-past cycles as `expired`. Idempotent — safe to call on every
 * Benefits screen mount.
 *
 * This is the app-side answer to "cycles rolling over when time passes".
 * Long-term a Supabase scheduled function would be more robust, but this
 * keeps the rollover logic visible in TS while we iterate.
 */
export function useEnsureCycles(portfolioId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!portfolioId) return { created: 0, expired: 0 };

      const { data, error } = await supabase
        .from("user_cards")
        .select(
          `
          id,
          opened_on,
          card_product:card_products(
            benefit_definitions(
              id, reset_frequency, reset_basis, value_per_period, annual_value
            )
          ),
          user_benefit_cycles(id, benefit_definition_id, period_start, period_end, status)
          `,
        )
        .eq("portfolio_id", portfolioId)
        .eq("is_active", true);
      if (error) throw error;

      type Def = {
        id: string;
        reset_frequency: ResetFrequency;
        reset_basis: "calendar" | "anniversary";
        value_per_period: number | null;
        annual_value: number | null;
      };
      type Cycle = {
        id: string;
        benefit_definition_id: string;
        period_start: string;
        period_end: string;
        status: string;
      };
      type Row = {
        id: string;
        opened_on: string | null;
        card_product: { benefit_definitions: Def[] } | null;
        user_benefit_cycles: Cycle[];
      };

      const today = new Date();
      const todayIso = iso(today);
      const cards = (data as unknown as Row[]) ?? [];
      const toCreate: Array<Record<string, unknown>> = [];
      const toExpire: string[] = [];

      for (const card of cards) {
        const openedOn = card.opened_on ? new Date(card.opened_on) : null;
        const defs = card.card_product?.benefit_definitions ?? [];
        for (const d of defs) {
          const hasCurrent = card.user_benefit_cycles.some(
            (c) =>
              c.benefit_definition_id === d.id &&
              c.period_start <= todayIso &&
              c.period_end >= todayIso,
          );
          if (!hasCurrent) {
            let period: { start: string; end: string } | null = null;
            if (d.reset_basis === "calendar") {
              period = computeCalendarPeriod(today, d.reset_frequency);
            } else if (d.reset_basis === "anniversary" && openedOn) {
              period = computeAnniversaryPeriod(today, openedOn, d.reset_frequency);
            }
            if (period) {
              toCreate.push({
                user_card_id: card.id,
                benefit_definition_id: d.id,
                period_start: period.start,
                period_end: period.end,
                allotted_value: d.value_per_period ?? d.annual_value ?? null,
                status: "unused",
              });
            }
          }
        }
        for (const c of card.user_benefit_cycles) {
          if (c.period_end < todayIso && c.status !== "expired") {
            toExpire.push(c.id);
          }
        }
      }

      if (toCreate.length > 0) {
        const { error: insErr } = await supabase
          .from("user_benefit_cycles")
          .insert(toCreate);
        if (insErr) throw insErr;
      }
      if (toExpire.length > 0) {
        const { error: updErr } = await supabase
          .from("user_benefit_cycles")
          .update({ status: "expired" })
          .in("id", toExpire);
        if (updErr) throw updErr;
      }

      return { created: toCreate.length, expired: toExpire.length };
    },
    onSuccess: (result) => {
      if (result && (result.created > 0 || result.expired > 0)) {
        qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "benefits"] });
      }
    },
  });
}

/**
 * Mark a benefit as fully redeemed for its current cycle (insert a
 * redemption for the remaining allotted value), or undo the most recent
 * redemption on that cycle.
 *
 * This is a thin port of the old "toggle completed" UX. A proper redemption
 * flow (custom amount, notes, date) belongs in a dedicated screen — see the
 * TODO at the call site.
 */
export function useToggleBenefitRedeemed(portfolioId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      benefit: UserVisibleBenefit;
      redeem: boolean;
    }) => {
      const { benefit, redeem } = args;
      if (!benefit.cycle) {
        throw new Error("No active cycle for this benefit yet.");
      }
      if (redeem) {
        if (benefit.cycle.allotted_value == null) {
          throw new Error("Cycle has no allotted value.");
        }
        const remaining = Math.max(
          Number(benefit.cycle.allotted_value) - benefit.redeemed_amount,
          0,
        );
        if (remaining <= 0) return;
        const { error } = await supabase.from("benefit_redemptions").insert({
          benefit_cycle_id: benefit.cycle.id,
          user_card_id: benefit.user_card_id,
          benefit_definition_id: benefit.benefit_definition_id,
          amount: remaining,
          redeemed_on: new Date().toISOString().slice(0, 10),
        });
        if (error) throw error;
      } else {
        // Undo: delete the most recent redemption on this cycle.
        const { data, error: selErr } = await supabase
          .from("benefit_redemptions")
          .select("id")
          .eq("benefit_cycle_id", benefit.cycle.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (selErr) throw selErr;
        if (!data) return;
        const { error: delErr } = await supabase
          .from("benefit_redemptions")
          .delete()
          .eq("id", (data as { id: string }).id);
        if (delErr) throw delErr;
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["portfolio", portfolioId, "benefits"] });
    },
  });
}
