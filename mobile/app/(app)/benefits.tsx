// Benefits screen — port of the Figma's main view.
//
// Renders cached data instantly on app start (TanStack Query + AsyncStorage
// persister), refetches in the background, and updates the UI smoothly when
// fresh data arrives.
//
// Toggling "completed" is optimistic — see useToggleBenefitCompleted in
// lib/hooks.ts for the rollback-on-error logic.

import { useMemo, useState } from "react";
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
import { useBenefits, useToggleBenefitCompleted } from "@/lib/hooks";
import { SPEND_CATEGORIES, type BenefitCategory } from "@/lib/types";

export default function BenefitsScreen() {
  const { data: benefits, isPending, error, refetch, isFetching } = useBenefits();
  const toggle = useToggleBenefitCompleted();

  const [filterCategory, setFilterCategory] = useState<BenefitCategory | null>(null);

  const filtered = useMemo(() => {
    const list = benefits ?? [];
    return filterCategory
      ? list.filter((b) => b.category === filterCategory)
      : list;
  }, [benefits, filterCategory]);

  // Sort: not-completed first; then by valid_to ascending (nulls last).
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.valid_to !== b.valid_to) {
        if (!a.valid_to) return 1;
        if (!b.valid_to) return -1;
        return new Date(a.valid_to).getTime() - new Date(b.valid_to).getTime();
      }
      return a.category.localeCompare(b.category);
    });
  }, [filtered]);

  const total = filtered.length;
  const pending = filtered.filter((b) => !b.completed).length;

  // Initial cold launch with no cache: show a spinner. After the first
  // successful query, isPending stays false even during background refetches
  // (use isFetching to check that).
  if (isPending) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
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
          <View className="gap-3">
            <View className="flex-row gap-3">
              <StatsCard label="Total" value={total} variant="blue" />
              <StatsCard label="Pending" value={pending} variant="orange" />
            </View>

            {/* Category filter chips. Horizontal scroll matches the Figma feel
                without needing a picker dependency. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingVertical: 4 }}
            >
              <FilterChip
                label="All"
                active={filterCategory === null}
                onPress={() => setFilterCategory(null)}
              />
              {SPEND_CATEGORIES.map((cat) => (
                <FilterChip
                  key={cat}
                  label={cat[0].toUpperCase() + cat.slice(1)}
                  active={filterCategory === cat}
                  onPress={() => setFilterCategory(cat)}
                />
              ))}
            </ScrollView>
          </View>
        }
        data={sorted}
        keyExtractor={(b) => String(b.benefit_id)}
        renderItem={({ item }) => (
          <BenefitCard
            benefit={item}
            onToggle={() =>
              toggle.mutate({
                benefitId: item.benefit_id,
                completed: !item.completed,
              })
            }
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text className="text-gray-500 text-center">
              No benefits to show yet.{"\n"}Add a card on the Cards tab to get started.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-3 py-1.5 rounded-full ${
        active ? "bg-blue-600" : "bg-white border border-gray-200"
      }`}
    >
      <Text className={`text-sm ${active ? "text-white" : "text-gray-700"}`}>
        {label}
      </Text>
    </Pressable>
  );
}
