// Benefits screen — lists every benefit_definition on every card in the
// current portfolio, with filters by category, card, and cycle expiry.

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BenefitCard } from "@/components/BenefitCard";
import { StatsCard } from "@/components/StatsCard";
import { notify } from "@/lib/dialog";
import {
  useBenefits,
  useCurrentPortfolio,
  useEnsureCycles,
  useToggleBenefitRedeemed,
} from "@/lib/hooks";

type ExpiryFilter = "all" | "week" | "month" | "quarter";

const EXPIRY_LABELS: Record<ExpiryFilter, string> = {
  all: "All",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
};

export default function BenefitsScreen() {
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data: benefits, isLoading, error, refetch, isFetching } = useBenefits(portfolioId);
  const toggle = useToggleBenefitRedeemed(portfolioId);
  const ensure = useEnsureCycles(portfolioId);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");

  useEffect(() => {
    if (portfolioId) ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  // Distinct categories present in the current benefits set, sorted.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of benefits ?? []) {
      if (b.benefit_category?.name) set.add(b.benefit_category.name);
    }
    return Array.from(set).sort();
  }, [benefits]);

  // Distinct (user_card_id, card_name) pairs present, sorted by name.
  const cards = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of benefits ?? []) {
      map.set(b.user_card_id, b.card_name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [benefits]);

  const filtered = useMemo(() => {
    const list = benefits ?? [];
    const now = new Date();
    const todayMs = now.getTime();
    const dayMs = 1000 * 60 * 60 * 24;
    const horizons: Record<ExpiryFilter, number> = {
      all: Infinity,
      week: 7,
      month: 30,
      quarter: 90,
    };
    const horizon = horizons[expiryFilter];

    return list.filter((b) => {
      if (categoryFilter && b.benefit_category?.name !== categoryFilter) return false;
      if (cardFilter && b.user_card_id !== cardFilter) return false;
      if (expiryFilter !== "all") {
        const end = b.cycle?.period_end;
        if (!end) return false;
        const daysUntil = (new Date(end).getTime() - todayMs) / dayMs;
        if (daysUntil < 0 || daysUntil > horizon) return false;
      }
      return true;
    });
  }, [benefits, categoryFilter, cardFilter, expiryFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.fully_redeemed !== b.fully_redeemed) return a.fully_redeemed ? 1 : -1;
      const aEnd = a.cycle?.period_end;
      const bEnd = b.cycle?.period_end;
      if (aEnd !== bEnd) {
        if (!aEnd) return 1;
        if (!bEnd) return -1;
        return new Date(aEnd).getTime() - new Date(bEnd).getTime();
      }
      return a.name.localeCompare(b.name);
    });
  }, [filtered]);

  const total = sorted.length;
  const pending = sorted.filter((b) => !b.fully_redeemed).length;
  const anyFilter =
    categoryFilter != null || cardFilter != null || expiryFilter !== "all";

  function clearFilters() {
    setCategoryFilter(null);
    setCardFilter(null);
    setExpiryFilter("all");
  }

  if (portfolioLoading || isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!portfolioId) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
        <View className="bg-white border-b border-gray-200 px-4 py-4">
          <Text className="text-2xl font-bold text-gray-900">Benefits</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-gray-600 text-center">
            You're not a member of any portfolio yet.{"\n"}
            Create one in Supabase to get started.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-600 text-center">{(error as Error).message}</Text>
          <Pressable
            onPress={() => refetch()}
            className="mt-4 px-4 py-2 bg-blue-600 rounded-xl"
          >
            <Text className="text-white font-medium">Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <Text className="text-2xl font-bold text-gray-900">Benefits</Text>
        <Text className="text-sm text-gray-600 mt-1">
          {isFetching ? "Refreshing..." : "Track your rewards"}
        </Text>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={
          <View className="gap-3 mb-3">
            <View className="flex-row gap-3">
              <StatsCard label="Total" value={total} variant="blue" />
              <StatsCard label="Pending" value={pending} variant="orange" />
            </View>

            {(categories.length > 0 || cards.length > 0) && (
              <View className="gap-2 mt-1">
                {categories.length > 0 && (
                  <FilterRow
                    label="Category"
                    options={[
                      { key: null, label: "All" },
                      ...categories.map((c) => ({ key: c, label: c })),
                    ]}
                    selected={categoryFilter}
                    onSelect={setCategoryFilter}
                  />
                )}
                {cards.length > 0 && (
                  <FilterRow
                    label="Card"
                    options={[
                      { key: null, label: "All" },
                      ...cards.map((c) => ({ key: c.id, label: c.name })),
                    ]}
                    selected={cardFilter}
                    onSelect={setCardFilter}
                  />
                )}
                <FilterRow<ExpiryFilter>
                  label="Expiring"
                  options={(Object.keys(EXPIRY_LABELS) as ExpiryFilter[]).map(
                    (k) => ({ key: k, label: EXPIRY_LABELS[k] }),
                  )}
                  selected={expiryFilter}
                  onSelect={setExpiryFilter}
                />

                {anyFilter && (
                  <Pressable onPress={clearFilters} className="self-start mt-1">
                    <Text className="text-xs text-blue-600 font-medium">
                      Clear filters
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        }
        data={sorted}
        keyExtractor={(b) => `${b.user_card_id}:${b.benefit_definition_id}`}
        renderItem={({ item }) => (
          <BenefitCard
            benefit={item}
            onToggle={() =>
              toggle.mutate(
                { benefit: item, redeem: !item.fully_redeemed },
                {
                  onError: (e) =>
                    notify("Redemption failed", (e as Error).message),
                },
              )
            }
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text className="text-gray-500 text-center">
              {anyFilter
                ? "No benefits match the current filters."
                : "No benefits to show yet.\nAdd a card on the Cards tab to get started."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function FilterRow<T extends string | null>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  selected: T;
  onSelect: (key: T) => void;
}) {
  return (
    <View>
      <Text className="text-xs text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      >
        {options.map((opt) => {
          const active = opt.key === selected;
          return (
            <Pressable
              key={String(opt.key)}
              onPress={() => onSelect(opt.key)}
              className={`px-3 py-1.5 rounded-full ${
                active ? "bg-blue-600" : "bg-white border border-gray-200"
              }`}
            >
              <Text
                className={`text-sm ${active ? "text-white" : "text-gray-700"}`}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
