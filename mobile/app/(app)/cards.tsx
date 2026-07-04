// Cards screen — add or remove cards from the current portfolio.
//
// Tapping "Add" opens a modal that asks when the card was opened. The
// date is used as the anchor for any anniversary-basis benefit cycles
// the card_product defines.
//
// Presentation is built on the design system (semantic tokens + Text/Button
// primitives + procedural card art); all data/handler logic below is unchanged.

import { router } from "expo-router";
import { Check, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CardArtThumbnail } from "@/components/CardArtThumbnail";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { confirmDestructive, notify } from "@/lib/dialog";
import {
  useAddUserCard,
  useCardProducts,
  useCurrentPortfolio,
  useRemoveUserCard,
  useUserCards,
} from "@/lib/hooks";
import { isOnboarded, markOnboarded } from "@/lib/onboarding";
import { supabase } from "@/lib/supabase";
import { colors, fonts } from "@/lib/theme";
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
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !active) return;
      const done = await isOnboarded(user.id);
      if (active && !done) setWelcomeVisible(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function dismissWelcome() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) await markOnboarded(user.id);
    setWelcomeVisible(false);
  }

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
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!portfolioId) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        <View className="bg-surface border-b border-border px-4 py-4">
          <Text variant="display">Cards</Text>
        </View>
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="body" className="text-text-muted text-center">
            You&apos;re not a member of any portfolio yet.{"\n"}
            Create one in Supabase to get started.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4">
        <Text variant="display">Cards</Text>
        <Text variant="caption" className="text-text-muted mt-1">
          {heldByProduct.size} of {allCards?.length ?? 0} added
        </Text>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        data={allCards ?? []}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => {
          const heldCard = heldByProduct.get(item.id);
          const held = heldCard != null;
          const annualFee =
            item.annual_fee != null ? `$${Number(item.annual_fee).toFixed(0)}/yr` : null;

          const rowContent = (
            <View className="flex-1 flex-row items-center pr-3">
              <CardArtThumbnail seed={item.id} />
              <View className="flex-1 ml-3">
                <Text variant="title" numberOfLines={2}>
                  {item.name}
                </Text>
                <Text variant="caption" className="text-text-muted mt-0.5">
                  {item.issuer?.name}
                  {annualFee ? ` · ${annualFee}` : ""}
                </Text>
                {held && heldCard && (
                  <Text variant="caption" className="text-text-subtle mt-0.5">
                    Opened {formatOpenedOn(heldCard.opened_on)}
                  </Text>
                )}
              </View>
            </View>
          );

          return (
            <View className="bg-surface rounded-2xl p-3 flex-row items-center border border-border">
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
                  className="flex-1"
                >
                  {rowContent}
                </Pressable>
              ) : (
                <Pressable onPress={() => startAdd(item)} className="flex-1">
                  {rowContent}
                </Pressable>
              )}

              {held && heldCard ? (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${item.name}`}
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
                  className="w-10 h-10 rounded-full bg-success items-center justify-center"
                >
                  <Check size={20} color="white" />
                </Pressable>
              ) : (
                <Pressable
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.name}`}
                  onPress={() => startAdd(item)}
                  className="w-10 h-10 rounded-full bg-primary items-center justify-center"
                >
                  <Plus size={22} color="white" />
                </Pressable>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text variant="body" className="text-text-muted text-center">
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
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
            <Text variant="h2" className="mb-1">
              Add {addTarget?.name}
            </Text>
            <Text variant="body" className="text-text-muted mb-4">
              When did you open this card? Used to anchor anniversary-based
              benefit cycles.
            </Text>
            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Opened on
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textSubtle}
              value={openedOn}
              onChangeText={setOpenedOn}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => setAddTarget(null)}
              />
              <Button
                variant="primary"
                label="Add card"
                className="flex-1"
                loading={add.isPending}
                onPress={commitAdd}
              />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={welcomeVisible}
        transparent
        animationType="fade"
        onRequestClose={dismissWelcome}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-6 w-full max-w-md">
            <Text variant="h1" className="mb-2">
              Add your cards
            </Text>
            <Text variant="body" className="text-text-muted mb-6">
              Tap{" "}
              <Text
                variant="body"
                className="text-text"
                style={{ fontFamily: fonts.semibold }}
              >
                Add
              </Text>{" "}
              next to any card to add it to your portfolio. We&apos;ll track its
              benefits and credits for you, and you&apos;ll see them all on the
              Benefits tab.
            </Text>
            <Button variant="primary" label="Got it" fullWidth onPress={dismissWelcome} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
