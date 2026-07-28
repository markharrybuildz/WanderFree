// All-spend screen — the full transaction history for one user_card, with
// per-row delete. The card-details Spending card only shows the latest five
// entries and links here via "See all N transactions".
//
// Reuses useCardDetails (the same query key card-details renders from) rather
// than a dedicated query, so a delete on either screen invalidates one cache
// entry and both stay in sync. That query already returns every spend_entry —
// card-details just slices client-side.

import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Trash2 } from "lucide-react-native";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { confirmDestructive } from "@/lib/dialog";
import { fmtDate, usdCents } from "@/lib/format";
import { useCardDetails, useRemoveSpendEntry } from "@/lib/hooks";
import { snackbar } from "@/lib/snackbar";
import { colors } from "@/lib/theme";

type SpendEntry = {
  id: string;
  amount: number;
  spent_on: string;
  signup_bonus_id: string | null;
  created_at: string;
};

export default function CardSpendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card, isLoading, error } = useCardDetails(id);
  const removeSpend = useRemoveSpendEntry();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !card) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="body" className="text-error-text text-center mb-4">
            {error ? (error as Error).message : "Card not found."}
          </Text>
          <Button variant="primary" label="Back" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const c = card as unknown as {
    id: string;
    card_product: { name: string } | null;
    spend_entries: SpendEntry[];
  };

  // Newest first; created_at breaks ties within a day.
  const entries = [...c.spend_entries].sort(
    (a, b) =>
      b.spent_on.localeCompare(a.spent_on) ||
      b.created_at.localeCompare(a.created_at),
  );
  const total = entries.reduce((sum, s) => sum + Number(s.amount), 0);

  function deleteSpend(entry: SpendEntry) {
    const suffix = entry.signup_bonus_id
      ? " Bonus progress will be recalculated."
      : "";
    confirmDestructive({
      title: "Remove spend?",
      message: `Delete the ${usdCents(Number(entry.amount))} entry from ${fmtDate(
        entry.spent_on,
      )}?${suffix}`,
      confirmLabel: "Remove",
      onConfirm: () =>
        removeSpend.mutate(
          { entryId: entry.id, userCardId: c.id },
          {
            onSuccess: () => snackbar.success("Spend removed"),
            onError: (e) => snackbar.error((e as Error).message),
          },
        ),
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4 flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to card"
        >
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <View className="flex-1">
          <Text variant="h2" numberOfLines={1}>
            All spending
          </Text>
          <Text variant="caption" className="text-text-muted mt-0.5" numberOfLines={1}>
            {c.card_product?.name ?? "Card"}
          </Text>
        </View>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View className="flex-row items-baseline justify-between px-1 pb-3">
            <Text variant="label" className="text-text-subtle uppercase">
              {entries.length} {entries.length === 1 ? "transaction" : "transactions"}
            </Text>
            <Text variant="title">{usdCents(total)}</Text>
          </View>
        }
        renderItem={({ item: s, index }) => (
          <View
            className={cn(
              "flex-row items-center justify-between px-4 py-3 bg-surface border-x border-border",
              index === 0 && "rounded-t-2xl border-t",
              index === entries.length - 1
                ? "rounded-b-2xl border-b"
                : "border-b",
            )}
          >
            <Text variant="body" className="text-text-muted">
              {fmtDate(s.spent_on)}
            </Text>
            <View className="flex-row items-center gap-3">
              <Text variant="title">{usdCents(Number(s.amount))}</Text>
              <Pressable
                hitSlop={8}
                onPress={() => deleteSpend(s)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${usdCents(Number(s.amount))} spend from ${fmtDate(s.spent_on)}`}
              >
                <Trash2 size={18} color={colors.textSubtle} />
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View className="px-4 py-10 items-center">
            <Text variant="callout" className="text-text-muted text-center">
              No spend recorded yet.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
