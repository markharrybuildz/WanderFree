// Cards screen — add or remove cards from the current portfolio.
//
// Tapping "Add" opens a modal that asks when the card was opened. The
// date is used as the anchor for any anniversary-basis benefit cycles
// the card_product defines.

import { router } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { confirmDestructive, notify } from "@/lib/dialog";
import {
  useAddUserCard,
  useCardProducts,
  useCurrentPortfolio,
  useRemoveUserCard,
  useUserCards,
} from "@/lib/hooks";
import type { CardProduct } from "@/lib/types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatOpenedOn(iso: string | null): string {
  if (!iso) return "Not set";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CardsScreen() {
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const {
    data: allCards,
    isLoading: loadingCards,
    isFetching: fetchingCards,
    refetch: refetchCards,
  } = useCardProducts();
  const {
    data: userCards,
    isLoading: loadingUserCards,
    isFetching: fetchingUserCards,
    refetch: refetchUserCards,
  } = useUserCards(portfolioId);
  const add = useAddUserCard(portfolioId);
  const remove = useRemoveUserCard(portfolioId);

  const [addTarget, setAddTarget] = useState<CardProduct | null>(null);
  const [openedOn, setOpenedOn] = useState(todayIso());

  const refreshing = fetchingCards || fetchingUserCards;
  function onRefresh() {
    refetchCards();
    if (portfolioId) refetchUserCards();
  }

  const heldByProduct = new Map(
    (userCards ?? []).map((uc) => [uc.card_product_id, uc] as const),
  );

  function startAdd(card: CardProduct) {
    setOpenedOn(todayIso());
    setAddTarget(card);
  }

  function validateDate(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null; // empty = null in DB
    if (!ISO_DATE_RE.test(trimmed)) {
      notify("Invalid date", "Use YYYY-MM-DD, or leave blank.");
      return null;
    }
    if (Number.isNaN(new Date(trimmed).getTime())) {
      notify("Invalid date", "That date isn't valid.");
      return null;
    }
    return trimmed;
  }

  function commitAdd() {
    if (!addTarget) return;
    const trimmed = openedOn.trim();
    if (trimmed) {
      const valid = validateDate(openedOn);
      if (!valid) return;
    }
    add.mutate(
      { cardProductId: addTarget.id, openedOn: trimmed || null },
      {
        onSuccess: () => setAddTarget(null),
        onError: (e) => notify("Add failed", (e as Error).message),
      },
    );
  }

  if (portfolioLoading || loadingCards || loadingUserCards) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
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
          <Text className="text-2xl font-bold text-gray-900">Cards</Text>
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

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <Text className="text-2xl font-bold text-gray-900">Cards</Text>
        <Text className="text-sm text-gray-600 mt-1">
          {heldByProduct.size} of {allCards?.length ?? 0} added
        </Text>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        data={allCards ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => {
          const heldCard = heldByProduct.get(item.id);
          const held = heldCard != null;
          const annualFee =
            item.annual_fee != null ? `$${Number(item.annual_fee).toFixed(0)}/yr` : null;

          const rowBody = (
            <>
              <Text className="text-base font-medium text-gray-900">
                {item.name}
              </Text>
              <Text className="text-xs text-gray-500 mt-1">
                {item.issuer?.name}
                {annualFee ? ` · ${annualFee}` : ""}
              </Text>
              {held && heldCard && (
                <Text className="text-xs text-gray-600 mt-1">
                  Opened {formatOpenedOn(heldCard.opened_on)}
                </Text>
              )}
            </>
          );

          return (
            <View className="bg-white rounded-xl p-4 flex-row items-center justify-between border border-gray-200">
              {held && heldCard ? (
                <Pressable
                  onPress={() =>
                    // Expo Router's generated typed routes don't include this
                    // new dynamic route until Metro restarts and regenerates
                    // the type union. Runtime resolution works fine.
                    router.push({
                      pathname: "/card-details/[id]" as never,
                      params: { id: heldCard.id },
                    })
                  }
                  className="flex-1 pr-3"
                >
                  {rowBody}
                </Pressable>
              ) : (
                <View className="flex-1 pr-3">{rowBody}</View>
              )}

              {held && heldCard ? (
                <Pressable
                  onPress={() =>
                    confirmDestructive({
                      title: "Remove card?",
                      message:
                        "Your benefit cycles and redemption history for this card will be removed.",
                      confirmLabel: "Remove",
                      onConfirm: () =>
                        remove.mutate(heldCard.id, {
                          onError: (e) =>
                            notify("Remove failed", (e as Error).message),
                        }),
                    })
                  }
                  className="flex-row items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 border border-red-200"
                >
                  <Trash2 size={14} color="#dc2626" />
                  <Text className="text-sm text-red-600 font-medium">
                    Remove
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => startAdd(item)}
                  className="px-4 py-2 rounded-lg bg-blue-600"
                >
                  <Text className="text-sm text-white font-medium">Add</Text>
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text className="text-gray-500 text-center">
              No cards in the catalog yet.{"\n"}
              Add card_products in Supabase to populate it.
            </Text>
          </View>
        }
      />

      <Modal
        visible={addTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setAddTarget(null)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="bg-white rounded-2xl p-5 w-full max-w-md">
            <Text className="text-lg font-semibold text-gray-900 mb-1">
              Add {addTarget?.name}
            </Text>
            <Text className="text-sm text-gray-600 mb-4">
              When did you open this card? Used to anchor anniversary-based
              benefit cycles.
            </Text>
            <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Opened on
            </Text>
            <TextInput
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-gray-900"
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              value={openedOn}
              onChangeText={setOpenedOn}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setAddTarget(null)}
                className="flex-1 py-3 rounded-xl bg-gray-100 items-center"
              >
                <Text className="text-gray-700 font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitAdd}
                disabled={add.isPending}
                className={`flex-1 py-3 rounded-xl items-center ${
                  add.isPending ? "bg-gray-300" : "bg-blue-600"
                }`}
              >
                <Text className="text-white font-medium">
                  {add.isPending ? "Adding..." : "Add card"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
