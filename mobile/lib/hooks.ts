// Data hooks for screens.
//
// Convention: one hook per query/mutation. Pages compose them; no business
// logic lives in the screen components themselves. This keeps screens easy
// to skim and lets us swap data sources later without rewriting UI.
//
// Cache keys:
//   ["user_visible_benefits"]     the per-user benefits view
//   ["all_cards"]                 the catalog of cards (everyone sees the same)
//   ["user_cards"]                which cards the current user has added

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "./supabase";
import type { Card, UserCard, UserVisibleBenefit } from "./types";

// ── Reads ────────────────────────────────────────────────────────────────

export function useBenefits() {
  return useQuery({
    queryKey: ["user_visible_benefits"],
    queryFn: async (): Promise<UserVisibleBenefit[]> => {
      const { data, error } = await supabase
        .from("user_visible_benefits")
        .select("*");
      if (error) throw error;
      return (data as UserVisibleBenefit[]) ?? [];
    },
  });
}

/** Whole catalog of cards — for the "Add a card" picker. */
export function useAllCards() {
  return useQuery({
    queryKey: ["all_cards"],
    queryFn: async (): Promise<Card[]> => {
      const { data, error } = await supabase
        .from("cards")
        .select("*, issuer:issuers(*), network_tier:network_tiers(*)")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data as Card[]) ?? [];
    },
    // Catalog only changes quarterly — much longer staleTime than per-user data.
    staleTime: 1000 * 60 * 60 * 24,
  });
}

/** Which cards the current user holds. */
export function useUserCards() {
  return useQuery({
    queryKey: ["user_cards"],
    queryFn: async (): Promise<UserCard[]> => {
      const { data, error } = await supabase
        .from("user_cards")
        .select("*, card:cards(*, issuer:issuers(*))");
      if (error) throw error;
      return (data as UserCard[]) ?? [];
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

export function useAddUserCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cardId: number) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("user_cards")
        .insert({ user_id: user.id, card_id: cardId });
      if (error) throw error;
    },
    onSuccess: () => {
      // Both queries depend on user_cards.
      qc.invalidateQueries({ queryKey: ["user_cards"] });
      qc.invalidateQueries({ queryKey: ["user_visible_benefits"] });
    },
  });
}

export function useRemoveUserCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cardId: number) => {
      const { error } = await supabase
        .from("user_cards")
        .delete()
        .eq("card_id", cardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user_cards"] });
      qc.invalidateQueries({ queryKey: ["user_visible_benefits"] });
    },
  });
}

/**
 * Toggle whether the user has redeemed/used a benefit.
 *
 * Uses an optimistic update so the UI flips instantly; if the network call
 * fails, we roll back. This is the kind of micro-interaction that makes the
 * difference between an app feeling fast and feeling sluggish.
 */
export function useToggleBenefitCompleted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { benefitId: number; completed: boolean }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("user_benefits").upsert(
        {
          user_id: user.id,
          benefit_id: args.benefitId,
          completed: args.completed,
          completed_at: args.completed ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,benefit_id" },
      );
      if (error) throw error;
    },

    // Optimistic update — flip the cached row immediately.
    onMutate: async ({ benefitId, completed }) => {
      await qc.cancelQueries({ queryKey: ["user_visible_benefits"] });
      const previous = qc.getQueryData<UserVisibleBenefit[]>([
        "user_visible_benefits",
      ]);
      qc.setQueryData<UserVisibleBenefit[]>(
        ["user_visible_benefits"],
        (old) =>
          old?.map((b) =>
            b.benefit_id === benefitId
              ? {
                  ...b,
                  completed,
                  completed_at: completed ? new Date().toISOString() : null,
                }
              : b,
          ) ?? [],
      );
      return { previous };
    },

    onError: (_err, _vars, ctx) => {
      // Roll back to the snapshot we took in onMutate.
      if (ctx?.previous) {
        qc.setQueryData(["user_visible_benefits"], ctx.previous);
      }
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["user_visible_benefits"] });
    },
  });
}
