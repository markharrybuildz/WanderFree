// Home screen — the action-oriented landing tab.
//
// Layout (top → bottom):
//   1. Header — title + the profile button (top right), which opens the
//      Profiles switcher sheet (moved here from the old Settings screen;
//      "profile" is the user-facing name for a portfolio).
//   2. AdSlot — renders nothing until an ad source is integrated.
//   3. "Signup bonuses" — one row per card with an open (incomplete) bonus,
//      with a progress bar toward the required spend. Tap → card details.
//   4. "Expiring soon" — benefits whose cycle ends within 30 days, most
//      urgent first. Tap → benefit detail.

import { router } from "expo-router";
import { CircleUser, Check, Plus, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { AdSlot } from "@/components/AdSlot";
import { BenefitRow, daysUntil } from "@/components/BenefitRow";
import { CardArtThumbnail } from "@/components/CardArtThumbnail";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useAuthSession } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { confirmDestructive, notify } from "@/lib/dialog";
import { benefitValue, fmtDate, formatProgramAmount, usd } from "@/lib/format";
import {
  type SignupBonusProgress,
  useBenefits,
  useCreatePortfolio,
  useCurrentPortfolio,
  useDeletePortfolio,
  useEnsureCycles,
  useSetCurrentPortfolio,
  useSignupBonuses,
  useUserPortfolios,
} from "@/lib/hooks";
import { snackbar, snackbarAfterModalClose } from "@/lib/snackbar";
import { colors, fonts } from "@/lib/theme";
import type { Portfolio, UserVisibleBenefit } from "@/lib/types";

const EXPIRING_HORIZON_DAYS = 30;

export default function HomeScreen() {
  const { session } = useAuthSession();
  // Bottom inset for the profiles sheet — Android 15 draws edge-to-edge,
  // so fixed padding would sit under the gesture bar.
  const insets = useSafeAreaInsets();
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const {
    data: benefits,
    isLoading: loadingBenefits,
    isFetching: fetchingBenefits,
    refetch: refetchBenefits,
    error: benefitsError,
  } = useBenefits(portfolioId);
  const {
    data: bonuses,
    isLoading: loadingBonuses,
    isFetching: fetchingBonuses,
    refetch: refetchBonuses,
    error: bonusesError,
  } = useSignupBonuses(portfolioId);
  const ensure = useEnsureCycles(portfolioId);

  // Profiles switcher (the "portfolio" concept, renamed in the UI).
  const { data: profiles } = useUserPortfolios();
  const setCurrent = useSetCurrentPortfolio();
  const create = useCreatePortfolio();
  const deleteProfile = useDeletePortfolio();
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Home is the landing tab, so it owns the idempotent cycle rollover.
  useEffect(() => {
    if (portfolioId) ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  const openBonuses = useMemo(
    () => (bonuses ?? []).filter((b) => !b.isCompleted),
    [bonuses],
  );

  // Unredeemed benefits with value left whose cycle ends within the horizon,
  // most urgent first.
  const expiring = useMemo(() => {
    const rows: { b: UserVisibleBenefit; d: number }[] = [];
    for (const b of benefits ?? []) {
      if (b.fully_redeemed) continue;
      const d = daysUntil(b.cycle?.period_end);
      if (d == null || d < 0 || d > EXPIRING_HORIZON_DAYS) continue;
      const v = benefitValue(b);
      if (v != null && Math.max(0, v - b.redeemed_amount) <= 0) continue;
      rows.push({ b, d });
    }
    rows.sort((a, b) => a.d - b.d || a.b.name.localeCompare(b.b.name));
    return rows.map((r) => r.b);
  }, [benefits]);

  function handleSwitch(p: Portfolio) {
    if (p.id !== portfolio?.id) setCurrent.mutate(p);
    setProfilesOpen(false);
  }

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: () => {
        setCreating(false);
        setNewName("");
        snackbarAfterModalClose(() => snackbar.success("Profile created"));
      },
      // Create modal stays open on failure, so keep the in-modal Alert.
      onError: (e) => notify("Could not create profile", (e as Error).message),
    });
  }

  function handleDelete(p: Portfolio) {
    confirmDestructive({
      title: `Delete "${p.name}"?`,
      message:
        "All cards, benefit cycles, redemptions, spend entries, and wallet balances in this profile will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: () =>
        deleteProfile.mutate(p.id, {
          onError: (e) => notify("Delete failed", (e as Error).message),
        }),
    });
  }

  const openBenefit = (b: UserVisibleBenefit) =>
    router.push({
      pathname: "/benefit-detail/[key]" as never,
      params: { key: `${b.user_card_id}__${b.benefit_definition_id}` },
    });

  const refreshing = fetchingBenefits || fetchingBonuses;
  function onRefresh() {
    refetchBenefits();
    refetchBonuses();
  }

  if (portfolioLoading || loadingBenefits || loadingBonuses) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // A failed fetch must not render as "all caught up".
  if (benefitsError || bonusesError) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="body" className="text-error-text text-center mb-4">
            {((benefitsError ?? bonusesError) as Error).message}
          </Text>
          <Button
            variant="primary"
            label="Retry"
            loading={refreshing}
            onPress={onRefresh}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4 flex-row items-center justify-between">
        <View>
          <Text variant="display">Home</Text>
          <Text variant="caption" className="text-text-muted mt-1">
            {portfolio?.name ?? "Your cards"}
          </Text>
        </View>
        <Pressable
          onPress={() => setProfilesOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Switch profile"
          className="w-11 h-11 rounded-full bg-primary-subtle items-center justify-center active:bg-primary/20"
        >
          <CircleUser size={24} color={colors.primaryStrong} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <AdSlot />

        {openBonuses.length > 0 && (
          <>
            <Text variant="label" className="text-text-muted uppercase mt-1">
              Signup bonuses
            </Text>
            {openBonuses.map((sb) => (
              <BonusRow key={sb.bonusId} sb={sb} />
            ))}
          </>
        )}

        <Text variant="label" className="text-text-muted uppercase mt-2">
          Expiring soon
        </Text>
        {expiring.length > 0 ? (
          expiring.map((b) => (
            <BenefitRow
              key={`${b.user_card_id}:${b.benefit_definition_id}`}
              b={b}
              onOpen={openBenefit}
            />
          ))
        ) : (
          <View className="bg-surface rounded-2xl border border-border px-4 py-6 items-center">
            <Text variant="callout" className="text-text-muted text-center">
              {(benefits ?? []).length > 0
                ? `Nothing expiring in the next ${EXPIRING_HORIZON_DAYS} days. You're all caught up.`
                : "Add a card on the Cards tab to start tracking benefits."}
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={profilesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setProfilesOpen(false)}
      >
        <Pressable
          className="flex-1 bg-overlay/40 justify-end"
          onPress={() => setProfilesOpen(false)}
        >
          <Pressable
            className="bg-surface rounded-t-3xl px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 24) + 16 }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text variant="h2" className="mb-2">
              Profiles
            </Text>
            {(profiles ?? []).map((p) => {
              const isCurrent = p.id === portfolio?.id;
              const canDelete = !!session && p.created_by === session.user.id;
              return (
                <View
                  key={p.id}
                  className="flex-row items-center border-b border-border"
                >
                  <Pressable
                    onPress={() => handleSwitch(p)}
                    className="flex-1 flex-row items-center justify-between py-3"
                  >
                    <Text
                      variant={isCurrent ? "title" : "body"}
                      className={isCurrent ? "text-primary-strong" : "text-text"}
                    >
                      {p.name}
                    </Text>
                    {isCurrent && <Check size={18} color={colors.primaryStrong} />}
                  </Pressable>
                  {canDelete && (
                    <Pressable
                      onPress={() => handleDelete(p)}
                      className="ml-3 p-1"
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete profile ${p.name}`}
                    >
                      <Trash2 size={17} color={colors.textSubtle} />
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable
              onPress={() => {
                setProfilesOpen(false);
                setNewName("");
                // iOS can't present a modal while another is mid-dismissal —
                // opening in the same tick silently fails. Wait out the
                // sheet's closing animation first.
                setTimeout(() => setCreating(true), 350);
              }}
              className="flex-row items-center gap-2 py-3.5"
            >
              <Plus size={18} color={colors.primaryStrong} />
              <Text variant="callout" className="text-primary-strong">
                New profile
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={creating}
        transparent
        animationType="fade"
        onRequestClose={() => setCreating(false)}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
            <Text variant="h2" className="mb-4">
              New profile
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="Name (e.g. Household, Business)"
              placeholderTextColor={colors.textSubtle}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => setCreating(false)}
              />
              <Button
                variant="primary"
                label="Create"
                className="flex-1"
                disabled={!newName.trim()}
                loading={create.isPending}
                onPress={handleCreate}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Signup-bonus progress row ───────────────────────────────────────────────

function BonusRow({ sb }: { sb: SignupBonusProgress }) {
  // Guard requiredSpend <= 0 (possible via direct DB edits) — NaN% width
  // crashes the progress bar layout.
  const pct =
    sb.requiredSpend > 0
      ? Math.min(100, Math.round((sb.spent / sb.requiredSpend) * 100))
      : 100;
  const toGo = Math.max(0, sb.requiredSpend - sb.spent);
  // Flag deadlines within two weeks — bonus windows are typically 3 months,
  // so this is the "get moving" zone.
  const d = daysUntil(sb.deadline);
  const urgent = d != null && d >= 0 && d <= 14;

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/card-details/[id]" as never,
          params: { id: sb.userCardId },
        })
      }
      className="bg-surface rounded-2xl p-3.5 border border-border"
    >
      <View className="flex-row items-center">
        <CardArtThumbnail seed={sb.artSeed} />
        <View className="flex-1 ml-3 mr-2">
          <Text variant="title" numberOfLines={1}>
            {sb.cardName}
          </Text>
        </View>
        {sb.bonusValue != null && (
          <View className="shrink-0 px-3 py-1.5 rounded-full bg-primary-subtle">
            <Text variant="callout" className="text-primary-strong">
              {formatProgramAmount(sb.bonusValue, sb.unitType)}
            </Text>
          </View>
        )}
      </View>
      <View className="h-2 rounded-full bg-surface-muted overflow-hidden mt-3">
        <View
          className="h-2 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </View>
      <Text
        variant="caption"
        className={cn("mt-1.5", urgent ? "text-warning" : "text-text-muted")}
      >
        {usd(sb.spent)} of {usd(sb.requiredSpend)} spent · {usd(toGo)} to go
        {sb.deadline ? ` · by ${fmtDate(sb.deadline)}` : ""}
      </Text>
    </Pressable>
  );
}
