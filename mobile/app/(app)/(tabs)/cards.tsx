// Cards screen — add or remove cards from the current portfolio.
//
// Tapping "Add" opens a modal that asks when the card was opened. The
// date is used as the anchor for any anniversary-basis benefit cycles
// the card_product defines.
//
// Presentation is built on the design system (semantic tokens + Text/Button
// primitives + procedural card art); all data/handler logic below is unchanged.

import { router, useFocusEffect } from "expo-router";
import { Check, Plus, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CardArtThumbnail } from "@/components/CardArtThumbnail";
import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { Text } from "@/components/ui/Text";
import { confirmDestructive, notify } from "@/lib/dialog";
import { localIsoDay, programUnitLabel } from "@/lib/format";
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

function todayIso(): string {
  return localIsoDay();
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
  const [openedOn, setOpenedOn] = useState<string | null>(todayIso());
  const [bonusSpend, setBonusSpend] = useState("");
  const [bonusValue, setBonusValue] = useState("");
  const [bonusDeadline, setBonusDeadline] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [welcomeVisible, setWelcomeVisible] = useState(false);

  // Tab screens stay mounted, so an open keyboard would otherwise survive a
  // tab switch and greet the user on their way back in.
  useFocusEffect(
    useCallback(() => {
      return () => Keyboard.dismiss();
    }, []),
  );

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

  // Total annual fees across the cards the user actually holds.
  const heldFees = (userCards ?? []).reduce(
    (sum, uc) => sum + Number(uc.card_product?.annual_fee ?? 0),
    0,
  );

  // Word-wise search: every whitespace-separated term must appear somewhere
  // in the card name or issuer name.
  const visibleCards = useMemo(() => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return allCards ?? [];
    return (allCards ?? []).filter((c) => {
      const haystack = `${c.name} ${c.issuer?.name ?? ""}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [allCards, search]);

  function startAdd(card: CardProduct) {
    setOpenedOn(todayIso());
    setBonusSpend("");
    setBonusValue("");
    setBonusDeadline(null);
    setAddTarget(card);
  }

  function parseAmount(value: string): number | null {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function commitAdd() {
    if (!addTarget) return;

    // Signup bonus is optional; required spend is the anchor field.
    let bonus = null;
    const requiredSpend = parseAmount(bonusSpend);
    if (bonusSpend.trim() && requiredSpend == null) {
      notify("Invalid amount", "Required spend must be a positive number.");
      return;
    }
    if (requiredSpend != null) {
      const value = parseAmount(bonusValue);
      if (bonusValue.trim() && value == null) {
        notify("Invalid amount", "Bonus value must be a positive number.");
        return;
      }
      bonus = {
        requiredSpend,
        bonusValue: value,
        deadline: bonusDeadline,
      };
    } else if (bonusValue.trim() || bonusDeadline) {
      notify(
        "Missing required spend",
        "Enter the required spend to track this signup bonus.",
      );
      return;
    }

    add.mutate(
      { cardProductId: addTarget.id, openedOn, bonus },
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
            You&apos;re not a member of any profile yet.{"\n"}
            Create one to get started.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 pt-4 pb-3">
        <View className="flex-row items-start justify-between">
          <View>
            <Text variant="display">Cards</Text>
            <Text variant="caption" className="text-text-muted mt-1">
              {heldByProduct.size} of {allCards?.length ?? 0} added
            </Text>
          </View>
          {heldFees > 0 && (
            <View className="items-end bg-primary-subtle rounded-xl px-3 py-2">
              <Text variant="label" className="text-primary-strong uppercase">
                Annual fees
              </Text>
              <Text variant="h2" className="text-primary-strong">
                ${Math.round(heldFees).toLocaleString()}
                <Text variant="caption" className="text-primary-strong">/yr</Text>
              </Text>
            </View>
          )}
        </View>
        <View className="flex-row items-center mt-3 gap-2">
          <View className="flex-1 flex-row items-center bg-surface-muted rounded-xl px-3">
            <Search size={16} color={colors.textMuted} />
            <TextInput
              className="flex-1 px-2 py-2.5 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 15 }}
              placeholder="Search cards by name or issuer"
              placeholderTextColor={colors.textSubtle}
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Search cards"
            />
            {search.length > 0 && (
              <Pressable
                onPress={() => setSearch("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={16} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          {searchFocused && (
            <Pressable
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss keyboard"
            >
              <Text variant="callout" className="text-primary-strong">
                Done
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        data={visibleCards}
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
              {search.trim()
                ? `No cards match “${search.trim()}”.`
                : "No cards in the catalog yet.\nAdd card_products in Supabase to populate it."}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 items-center justify-center bg-overlay/40 px-6"
        >
          <ScrollView
            className="bg-surface rounded-2xl w-full max-w-md max-h-[80%] grow-0"
            contentContainerStyle={{ padding: 20 }}
            keyboardShouldPersistTaps="handled"
          >
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
            <DateField
              value={openedOn}
              onChange={setOpenedOn}
              placeholder="Not set"
              clearable
              maximumDate={new Date()}
              className="mb-4"
              accessibilityLabel="Opened on date"
            />

            <Text variant="label" className="text-text-subtle uppercase mb-1">
              Signup bonus (optional)
            </Text>
            <Text variant="caption" className="text-text-muted mb-3">
              Track your progress toward the welcome offer. You can add or
              edit this later from the card&apos;s details.
            </Text>
            <View className="flex-row gap-3 mb-4">
              <View className="flex-1">
                <Text variant="label" className="text-text-subtle uppercase mb-2">
                  Required spend
                </Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-text"
                  style={{ fontFamily: fonts.regular, fontSize: 16 }}
                  placeholder="$4,000"
                  placeholderTextColor={colors.textSubtle}
                  value={bonusSpend}
                  onChangeText={setBonusSpend}
                  keyboardType="decimal-pad"
                />
              </View>
              <View className="flex-1">
                <Text variant="label" className="text-text-subtle uppercase mb-2">
                  Bonus ({programUnitLabel(addTarget?.rewards_program?.unit_type)})
                </Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-3 text-text"
                  style={{ fontFamily: fonts.regular, fontSize: 16 }}
                  placeholder={
                    addTarget?.rewards_program?.unit_type === "cash_back"
                      ? "$200"
                      : "60,000"
                  }
                  placeholderTextColor={colors.textSubtle}
                  value={bonusValue}
                  onChangeText={setBonusValue}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Spend deadline
            </Text>
            <DateField
              value={bonusDeadline}
              onChange={setBonusDeadline}
              placeholder="No deadline"
              clearable
              className="mb-4"
              accessibilityLabel="Spend deadline date"
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
          </ScrollView>
        </KeyboardAvoidingView>
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
