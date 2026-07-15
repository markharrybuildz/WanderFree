// Points screen — rewards balances per program.
//
// Points live at the PROGRAM level, not the card level (two Chase cards
// pool into one Ultimate Rewards balance), so each row is a rewards program
// showing: the balance in its native unit, the active cards that earn into
// it, an amber "pending" pill for incomplete signup-bonus value, and a
// pencil to edit the balance manually (Set total / Add — no bank linking).
// Completed signup bonuses auto-credit the balance via a DB trigger.

import { Pencil } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CardArtThumbnail } from "@/components/CardArtThumbnail";
import { Text } from "@/components/ui/Text";
import { WalletEditModal } from "@/components/WalletEditModal";
import { notify } from "@/lib/dialog";
import { formatProgramAmount } from "@/lib/format";
import {
  type ProgramWallet,
  useCurrentPortfolio,
  useProgramWallets,
  useSetWalletBalance,
} from "@/lib/hooks";
import { colors } from "@/lib/theme";

export default function PointsScreen() {
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data, isLoading, isFetching, refetch, error } =
    useProgramWallets(portfolioId);
  const wallets = data?.wallets;
  const unlinkedCards = data?.unlinkedCards ?? [];
  const setBalance = useSetWalletBalance(portfolioId);

  const [editing, setEditing] = useState<ProgramWallet | null>(null);

  if (portfolioLoading || isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4">
        <Text variant="display">Points</Text>
        <Text variant="caption" className="text-text-muted mt-1">
          Your rewards balances
        </Text>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        data={wallets ?? []}
        keyExtractor={(w) => w.programId}
        renderItem={({ item }) => (
          <View className="bg-surface rounded-2xl p-4 border border-border">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 pr-3">
                <Text variant="callout" className="text-text-muted">
                  {item.programName}
                </Text>
                <Text variant="h1" className="mt-0.5">
                  {formatProgramAmount(item.balance, item.unitType)}
                </Text>
              </View>
              <Pressable
                onPress={() => setEditing(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.programName} balance`}
                className="w-9 h-9 rounded-full bg-surface-muted items-center justify-center active:bg-primary-subtle"
              >
                <Pencil size={15} color={colors.textMuted} />
              </Pressable>
            </View>

            {(item.cards.length > 0 || item.pendingBonus > 0) && (
              <View className="flex-row items-center mt-3">
                <View className="flex-row items-center flex-1 mr-2">
                  {item.cards.slice(0, 4).map((c) => (
                    <View key={c.userCardId} className="mr-1.5">
                      <CardArtThumbnail seed={c.artSeed} width={34} />
                    </View>
                  ))}
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    className="text-text-muted ml-1 shrink"
                  >
                    {item.cards.map((c) => c.name).join(" · ")}
                  </Text>
                </View>
                {item.pendingBonus > 0 && (
                  <View className="shrink-0 px-2 py-0.5 rounded-full bg-warning-subtle">
                    <Text variant="label" className="text-warning">
                      +{formatProgramAmount(item.pendingBonus, item.unitType)} pending
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text variant="body" className="text-text-muted text-center">
              {error
                ? (error as Error).message
                : "No rewards programs yet.\nAdd a card on the Cards tab to start tracking points."}
            </Text>
          </View>
        }
        ListFooterComponent={
          unlinkedCards.length > 0 ? (
            <View className="mt-4">
              <Text variant="label" className="text-text-subtle uppercase mb-2">
                No rewards program
              </Text>
              {unlinkedCards.map((c) => (
                <View
                  key={c.userCardId}
                  className="bg-surface rounded-2xl p-3 mb-2 flex-row items-center border border-border opacity-70"
                >
                  <CardArtThumbnail seed={c.artSeed} width={34} />
                  <Text
                    variant="callout"
                    numberOfLines={1}
                    className="text-text-muted ml-3 flex-1"
                  >
                    {c.name}
                  </Text>
                </View>
              ))}
              <Text variant="caption" className="text-text-subtle mt-1 px-1">
                These cards don&apos;t earn points or cash back.
              </Text>
            </View>
          ) : null
        }
      />

      {editing && (
        <WalletEditModal
          open
          programName={editing.programName}
          unitType={editing.unitType}
          currentBalance={editing.balance}
          saving={setBalance.isPending}
          onClose={() => setEditing(null)}
          onSave={(newBalance) =>
            setBalance.mutate(
              { programId: editing.programId, balance: newBalance },
              {
                onSuccess: () => setEditing(null),
                onError: (e) => notify("Save failed", (e as Error).message),
              },
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
