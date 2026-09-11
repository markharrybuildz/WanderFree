// Card details — full view of one user_card with its benefits, signup-bonus
// tracking, manual spend entries, and edit affordances for the user-supplied
// metadata (nickname, last_four, opened_on). Reachable by tapping a held
// card on the Cards tab or a row on Home.

import { router, useLocalSearchParams } from "expo-router";
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { DetailRow } from "@/components/ui/DetailRow";
import { Text } from "@/components/ui/Text";
import { WalletEditModal } from "@/components/WalletEditModal";
import { cn } from "@/lib/cn";
import { confirmDestructive, notify } from "@/lib/dialog";
import {
  fmtDate,
  formatProgramAmount,
  localIsoDay,
  programUnitLabel,
  usd,
  usdCents,
} from "@/lib/format";
import {
  useAddSignupBonus,
  useAddSpendEntry,
  useCardDetails,
  useCardProducts,
  useChangeCardProduct,
  useCurrentPortfolio,
  useProgramWallets,
  useRemoveSpendEntry,
  useRemoveUserCard,
  useSetWalletBalance,
  useUpdateSignupBonus,
  useUpdateUserCard,
} from "@/lib/hooks";
import { snackbar, snackbarAfterModalClose } from "@/lib/snackbar";
import { colors, fonts } from "@/lib/theme";
import type { BonusEligibility, ProgramUnitType } from "@/lib/types";

// opened_on is a Postgres `date` ("YYYY-MM-DD"), which parses as UTC midnight —
// so formatting must go through fmtDate (pins timeZone: "UTC") or the calendar
// day shifts back one in negative-offset zones (all of the US).
function formatOpenedOn(iso: string | null): string {
  return iso ? fmtDate(iso) : "Not set";
}

/** Constrain a currency text field to digits and at most two decimal places,
 *  so what the user types matches what numeric(12,2) will actually store (it
 *  would otherwise silently round "10.999" to "11.00"). */
function sanitizeAmountInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const intPart = cleaned.slice(0, firstDot);
  const decPart = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${intPart}.${decPart}`;
}

function formatPeriod(start: string, end: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

const ELIGIBILITY_OPTIONS: { value: BonusEligibility; label: string }[] = [
  { value: "eligible", label: "Eligible" },
  { value: "not_eligible", label: "Not eligible" },
  { value: "eligible_on", label: "Eligible on" },
];

export default function CardDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Android 15 draws edge-to-edge; pad scroll content past the gesture bar.
  const insets = useSafeAreaInsets();
  const { data: portfolio } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const {
    data: card,
    isLoading,
    error,
    isFetching: fetchingCard,
    refetch: refetchCard,
  } = useCardDetails(id);
  const update = useUpdateUserCard(portfolioId);
  const remove = useRemoveUserCard(portfolioId);
  const addBonus = useAddSignupBonus();
  const updateBonus = useUpdateSignupBonus();
  const addSpend = useAddSpendEntry();
  const removeSpend = useRemoveSpendEntry();
  const { data: programWallets } = useProgramWallets(portfolioId);
  const setBalance = useSetWalletBalance(portfolioId);
  const changeProduct = useChangeCardProduct(portfolioId);
  const { data: catalog } = useCardProducts();
  const [walletEditOpen, setWalletEditOpen] = useState(false);
  const [productModal, setProductModal] = useState(false);

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [lastFour, setLastFour] = useState("");
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  // Inline errors shown inside the open modal (validation + save failure) —
  // a root snackbar can't overlay a modal, so in-modal feedback lives inline.
  const [editError, setEditError] = useState<string | null>(null);

  // Signup-bonus add/edit modal state. `bonusEditingId` is null when adding.
  const [bonusModal, setBonusModal] = useState(false);
  const [bonusEditingId, setBonusEditingId] = useState<string | null>(null);
  const [bonusSpendField, setBonusSpendField] = useState("");
  const [bonusValueField, setBonusValueField] = useState("");
  const [bonusDeadlineField, setBonusDeadlineField] = useState<string | null>(
    null,
  );
  const [bonusError, setBonusError] = useState<string | null>(null);

  // Add-spend modal state.
  const [spendModal, setSpendModal] = useState(false);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendDate, setSpendDate] = useState("");
  const [spendError, setSpendError] = useState<string | null>(null);

  function startEdit() {
    setNickname(card?.nickname ?? "");
    setLastFour(card?.last_four ?? "");
    setOpenedOn(card?.opened_on ?? null);
    setEditError(null);
    setEditing(true);
  }

  function commitEdit() {
    if (!card) return;
    setEditError(null);
    update.mutate(
      {
        userCardId: card.id,
        patch: {
          nickname: nickname.trim() || null,
          last_four: lastFour.trim() || null,
          opened_on: openedOn,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          snackbarAfterModalClose(() => snackbar.success("Changes saved"));
        },
        onError: (e) => setEditError((e as Error).message),
      },
    );
  }

  function doRemove(userCardId: string) {
    remove.mutate(userCardId, {
      onSuccess: () => {
        // Back to the list; the snackbar rides along on the root host.
        router.back();
        snackbar.success("Card removed");
      },
      onError: (e) =>
        snackbar.error((e as Error).message || "Couldn't remove card", {
          action: { label: "Retry", onPress: () => doRemove(userCardId) },
        }),
    });
  }

  function handleRemove() {
    if (!card) return;
    confirmDestructive({
      title: "Remove card?",
      message:
        "Your benefit cycles and redemption history for this card will be removed.",
      confirmLabel: "Remove",
      onConfirm: () => doRemove(card.id),
    });
  }

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
          <Button
            variant="primary"
            label="Back"
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Supabase joined columns come back loosely typed. Cast through unknown
  // for ergonomic access — the column list mirrors the queryFn select.
  const c = card as unknown as {
    id: string;
    nickname: string | null;
    last_four: string | null;
    opened_on: string | null;
    product_changed_from_id: string | null;
    bonus_eligibility: BonusEligibility;
    bonus_eligible_on: string | null;
    card_product: {
      id: string;
      name: string;
      network: string | null;
      annual_fee: number;
      issuer: { id: string; name: string } | null;
      rewards_program: {
        id: string;
        name: string;
        unit_type: ProgramUnitType;
      } | null;
      benefit_definitions: {
        id: string;
        name: string;
        value_per_period: number | null;
        annual_value: number | null;
        reset_frequency: string;
        reset_basis: string;
        requires_enrollment: boolean;
        benefit_category: { name: string } | null;
      }[];
    } | null;
    user_benefit_cycles: {
      id: string;
      benefit_definition_id: string;
      period_start: string;
      period_end: string;
      allotted_value: number | null;
      status: string;
    }[];
    benefit_redemptions: {
      id: string;
      benefit_definition_id: string;
      benefit_cycle_id: string;
      amount: number;
    }[];
    user_signup_bonuses: {
      id: string;
      required_spend: number;
      spend_deadline: string | null;
      bonus_value: number | null;
      is_completed: boolean;
      created_at: string;
    }[];
    spend_entries: {
      id: string;
      amount: number;
      spent_on: string;
      signup_bonus_id: string | null;
      created_at: string;
    }[];
  };

  const product = c.card_product;
  const program = product?.rewards_program ?? null;
  const programWallet = program
    ? ((programWallets?.wallets ?? []).find(
        (w) => w.programId === program.id,
      ) ?? null)
    : null;
  // null while the wallet query is in flight — editing must stay disabled,
  // or "Add" would compute from a phantom zero and clobber the real balance.
  const programBalance =
    programWallets == null ? null : (programWallet?.balance ?? 0);
  // Local calendar days — toISOString() would shift the day in US timezones,
  // and fixed-ms subtraction breaks across DST; step by date parts instead.
  const todayIso = localIsoDay();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = localIsoDay(yesterday);
  const annualFee =
    product?.annual_fee != null
      ? `$${Number(product.annual_fee).toFixed(0)}/yr`
      : null;

  // Product change (upgrade/downgrade): other products from the same issuer.
  const issuerId = product?.issuer?.id ?? null;
  const siblingProducts = (catalog ?? []).filter(
    (p) => p.issuer_id === issuerId && p.id !== product?.id,
  );
  const changedFromName = c.product_changed_from_id
    ? ((catalog ?? []).find((p) => p.id === c.product_changed_from_id)?.name ??
      null)
    : null;

  function doChangeProduct(newProductId: string, newProductName: string) {
    if (!product?.id) return;
    changeProduct.mutate(
      {
        userCardId: c.id,
        newCardProductId: newProductId,
      },
      {
        onSuccess: () => {
          setProductModal(false);
          snackbarAfterModalClose(() =>
            snackbar.success(`Changed to ${newProductName}`),
          );
        },
        onError: (e) => snackbar.error((e as Error).message),
      },
    );
  }

  // Signup-bonus eligibility is a manual per-card note; persist immediately.
  function setEligibility(next: BonusEligibility, eligibleOn: string | null) {
    update.mutate({
      userCardId: c.id,
      patch: {
        bonus_eligibility: next,
        bonus_eligible_on: next === "eligible_on" ? eligibleOn : null,
      },
    });
  }

  // The card's signup bonus. The schema allows several rows per card, but
  // the product concept is one welcome offer — show the most recent.
  const bonus =
    [...c.user_signup_bonuses].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )[0] ?? null;
  const bonusSpent = bonus
    ? c.spend_entries
        .filter((s) => s.signup_bonus_id === bonus.id)
        .reduce((sum, s) => sum + Number(s.amount), 0)
    : 0;
  const bonusPct = bonus
    ? bonus.is_completed
      ? 100
      : Math.min(
          100,
          Math.round((bonusSpent / Number(bonus.required_spend)) * 100),
        )
    : 0;
  const recentSpend = [...c.spend_entries]
    .sort(
      (a, b) =>
        b.spent_on.localeCompare(a.spent_on) ||
        b.created_at.localeCompare(a.created_at),
    )
    .slice(0, 5);

  function parseAmount(value: string): number | null {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function startBonusEdit() {
    setBonusEditingId(bonus?.id ?? null);
    setBonusSpendField(bonus ? String(bonus.required_spend) : "");
    setBonusValueField(
      bonus?.bonus_value != null ? String(bonus.bonus_value) : "",
    );
    setBonusDeadlineField(bonus?.spend_deadline ?? null);
    setBonusError(null);
    setBonusModal(true);
  }

  // Shared field parsing/validation for the bonus modal's Save and
  // Mark-as-earned actions. Returns null (and sets an inline error) on invalid.
  function readBonusFields(): {
    requiredSpend: number;
    value: number | null;
  } | null {
    const requiredSpend = parseAmount(bonusSpendField);
    if (requiredSpend == null) {
      setBonusError("Required spend must be a positive number.");
      return null;
    }
    const value = parseAmount(bonusValueField);
    if (bonusValueField.trim() && value == null) {
      setBonusError("Bonus value must be a positive number.");
      return null;
    }
    setBonusError(null);
    return { requiredSpend, value };
  }

  function commitBonus() {
    if (!card) return;
    const fields = readBonusFields();
    if (!fields) return;
    const { requiredSpend, value } = fields;
    const deadline = bonusDeadlineField;
    const onDone = {
      onSuccess: () => {
        setBonusModal(false);
        snackbarAfterModalClose(() => snackbar.success("Bonus saved"));
      },
      onError: (e: Error) => setBonusError(e.message),
    };
    if (bonusEditingId) {
      updateBonus.mutate(
        {
          bonusId: bonusEditingId,
          userCardId: c.id,
          patch: {
            required_spend: requiredSpend,
            bonus_value: value,
            spend_deadline: deadline,
            // Re-derive completion against the edited target.
            is_completed: bonusSpent >= requiredSpend,
          },
        },
        onDone,
      );
    } else {
      addBonus.mutate(
        {
          userCardId: c.id,
          bonus: { requiredSpend, bonusValue: value, deadline },
        },
        onDone,
      );
    }
  }

  // "Mark as earned" / undo on an existing bonus: saves the current field
  // values and flips is_completed. The DB trigger (trg_bonus_wallet_credit)
  // then credits — or reverses — the bonus value in the program's wallet.
  function setBonusEarned(completed: boolean) {
    if (!card || !bonusEditingId) return;
    const fields = readBonusFields();
    if (!fields) return;
    updateBonus.mutate(
      {
        bonusId: bonusEditingId,
        userCardId: c.id,
        patch: {
          required_spend: fields.requiredSpend,
          bonus_value: fields.value,
          spend_deadline: bonusDeadlineField,
          is_completed: completed,
        },
      },
      {
        onSuccess: () => {
          setBonusModal(false);
          snackbarAfterModalClose(() =>
            snackbar.success(
              completed ? "Bonus marked as earned" : "Bonus reopened",
            ),
          );
        },
        onError: (e: Error) => setBonusError(e.message),
      },
    );
  }

  // One-tap toggle straight from the bonus section (no edit modal). Flips
  // is_completed on the stored row; the DB trigger credits/reverses the bonus
  // value in the program wallet using its ledger, so no field values are needed.
  function toggleBonusDone(completed: boolean) {
    if (!card || !bonus) return;
    updateBonus.mutate(
      {
        bonusId: bonus.id,
        userCardId: c.id,
        patch: { is_completed: completed },
      },
      {
        onSuccess: () =>
          snackbar.success(
            completed ? "Bonus marked as earned" : "Bonus reopened",
          ),
        onError: (e: Error) =>
          snackbar.error(e.message || "Couldn't update bonus"),
      },
    );
  }

  function startAddSpend() {
    setSpendAmount("");
    setSpendDate(todayIso);
    setSpendError(null);
    setSpendModal(true);
  }

  function commitSpend() {
    if (!card) return;
    const amount = parseAmount(spendAmount);
    if (amount == null) {
      setSpendError("Enter a positive dollar amount.");
      return;
    }
    setSpendError(null);
    const date = spendDate || todayIso;
    addSpend.mutate(
      {
        userCardId: c.id,
        amount,
        spentOn: date,
        // Link ALL spend to the active bonus (even completed): if the user
        // later raises the required-spend target, unlinked entries would
        // under-report progress. The progress bar caps at 100% regardless.
        bonusId: bonus ? bonus.id : null,
      },
      {
        onSuccess: () => {
          setSpendModal(false);
          snackbarAfterModalClose(() => snackbar.success("Spend added"));
        },
        onError: (e) => setSpendError((e as Error).message),
      },
    );
  }

  function deleteSpend(entry: {
    id: string;
    amount: number;
    spent_on: string;
    signup_bonus_id: string | null;
  }) {
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
          accessibilityLabel="Back to cards"
        >
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <View className="flex-1">
          <Text variant="h2" numberOfLines={1}>
            {product?.name ?? "Card"}
          </Text>
          <Text
            variant="caption"
            className="text-text-muted mt-0.5"
            numberOfLines={1}
          >
            {product?.issuer?.name}
            {product?.network ? ` · ${product.network}` : ""}
            {annualFee ? ` · ${annualFee}` : ""}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 16,
          paddingBottom: insets.bottom + 24,
        }}
        refreshControl={
          <RefreshControl
            refreshing={fetchingCard}
            onRefresh={() => refetchCard()}
            tintColor={colors.primary}
          />
        }
      >
        <View className="bg-surface rounded-2xl border border-border">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text variant="label" className="text-text-subtle uppercase">
              Details
            </Text>
            <Pressable
              onPress={startEdit}
              className="flex-row items-center gap-1 px-2 py-1"
              hitSlop={4}
            >
              <Pencil size={13} color={colors.primaryStrong} />
              <Text variant="label" className="text-primary-strong">
                Edit
              </Text>
            </Pressable>
          </View>
          <DetailRow label="Nickname" value={c.nickname ?? "—"} />
          <DetailRow label="Last 4" value={c.last_four ?? "—"} />
          <DetailRow
            label="Opened on"
            value={formatOpenedOn(c.opened_on)}
            last
          />
        </View>

        <View>
          <Pressable
            onPress={() => setProductModal(true)}
            disabled={siblingProducts.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Change card product"
            className={cn(
              "flex-row items-center justify-center gap-2 py-2.5 rounded-xl border border-border",
              siblingProducts.length > 0 && "active:bg-surface-muted",
            )}
          >
            <ArrowUpDown
              size={15}
              color={
                siblingProducts.length > 0
                  ? colors.primaryStrong
                  : colors.textMuted
              }
            />
            <Text
              variant="callout"
              className={
                siblingProducts.length > 0
                  ? "text-primary-strong"
                  : "text-text-muted"
              }
            >
              {siblingProducts.length > 0
                ? "Change product (upgrade / downgrade)"
                : "No other products from this issuer"}
            </Text>
          </Pressable>
          {changedFromName && (
            <Text variant="caption" className="text-text-muted mt-2 text-center">
              Product-changed from {changedFromName}
            </Text>
          )}
        </View>

        {program && (
          <View className="bg-surface rounded-2xl border border-border">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
              <Text variant="label" className="text-text-subtle uppercase">
                Rewards
              </Text>
              {programBalance != null && (
                <Pressable
                  onPress={() => setWalletEditOpen(true)}
                  className="flex-row items-center gap-1 px-2 py-1"
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel="Edit points balance"
                >
                  <Pencil size={13} color={colors.primaryStrong} />
                  <Text variant="label" className="text-primary-strong">
                    Edit balance
                  </Text>
                </Pressable>
              )}
            </View>
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text variant="callout" className="text-text-muted flex-1 pr-3">
                {program.name}
              </Text>
              <Text variant="h2">
                {programBalance == null
                  ? "—"
                  : formatProgramAmount(programBalance, program.unit_type)}
              </Text>
            </View>
          </View>
        )}

        <View className="bg-surface rounded-2xl border border-border">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text variant="label" className="text-text-subtle uppercase">
              Signup bonus
            </Text>
            <Pressable
              onPress={startBonusEdit}
              className="flex-row items-center gap-1 px-2 py-1"
              hitSlop={4}
            >
              {bonus ? (
                <Pencil size={13} color={colors.primaryStrong} />
              ) : (
                <Plus size={14} color={colors.primaryStrong} />
              )}
              <Text variant="label" className="text-primary-strong">
                {bonus ? "Edit" : "Add"}
              </Text>
            </Pressable>
          </View>
          {bonus ? (
            <View className="px-4 py-3">
              <View className="flex-row items-center justify-between">
                <Text variant="title">
                  {usd(bonusSpent)}{" "}
                  <Text variant="callout" className="text-text-muted">
                    of {usd(Number(bonus.required_spend))} spent
                  </Text>
                </Text>
                {bonus.is_completed ? (
                  <View className="px-2 py-0.5 rounded-full bg-success-subtle">
                    <Text variant="label" className="text-success-text">
                      Earned
                    </Text>
                  </View>
                ) : (
                  <Text variant="callout" className="text-text-muted">
                    {usd(
                      Math.max(0, Number(bonus.required_spend) - bonusSpent),
                    )}{" "}
                    to go
                  </Text>
                )}
              </View>
              <View className="h-2 rounded-full bg-surface-muted overflow-hidden mt-2.5">
                <View
                  className={cn(
                    "h-2 rounded-full",
                    bonus.is_completed ? "bg-success" : "bg-primary",
                  )}
                  style={{ width: `${bonusPct}%` }}
                />
              </View>
              <Text variant="caption" className="text-text-muted mt-2">
                {bonus.bonus_value != null
                  ? `Earns ${formatProgramAmount(Number(bonus.bonus_value), program?.unit_type)}`
                  : "Bonus value not set"}
                {bonus.spend_deadline
                  ? ` · spend by ${fmtDate(bonus.spend_deadline)}`
                  : ""}
              </Text>
              <Pressable
                onPress={() => toggleBonusDone(!bonus.is_completed)}
                disabled={updateBonus.isPending}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: bonus.is_completed }}
                accessibilityLabel="Mark signup bonus as earned"
                className="flex-row items-center justify-center gap-2 mt-3 py-2.5 rounded-xl border border-border active:bg-surface-muted"
              >
                {bonus.is_completed ? (
                  <CircleCheck size={16} color={colors.successText} />
                ) : (
                  <Circle size={16} color={colors.textMuted} />
                )}
                <Text
                  variant="callout"
                  className={
                    bonus.is_completed
                      ? "text-success-text"
                      : "text-primary-strong"
                  }
                >
                  {bonus.is_completed
                    ? "Earned — tap to undo"
                    : "Mark as earned"}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="px-4 py-5 items-center">
              <Text variant="callout" className="text-text-muted text-center">
                No signup bonus tracked. Add one to follow your progress toward
                the welcome offer.
              </Text>
            </View>
          )}
          {/* Eligibility — a manual note of whether the user can earn this
              card's welcome offer, independent of whether one is being
              tracked above (e.g. "not eligible — earned before"). */}
          <View className="px-4 py-3 border-t border-border">
            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Eligibility
            </Text>
            <View className="flex-row gap-2">
              {ELIGIBILITY_OPTIONS.map((opt) => {
                const active = c.bonus_eligibility === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() =>
                      setEligibility(
                        opt.value,
                        opt.value === "eligible_on"
                          ? (c.bonus_eligible_on ?? todayIso)
                          : null,
                      )
                    }
                    disabled={update.isPending}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    className={cn(
                      "flex-1 items-center py-2 rounded-xl border",
                      active
                        ? "border-primary bg-primary-subtle"
                        : "border-border active:bg-surface-muted",
                    )}
                  >
                    <Text
                      variant="label"
                      className={
                        active ? "text-primary-strong" : "text-text-muted"
                      }
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {c.bonus_eligibility === "eligible_on" && (
              <DateField
                value={c.bonus_eligible_on}
                onChange={(d) => setEligibility("eligible_on", d)}
                placeholder="Select a date"
                minimumDate={new Date()}
                className="mt-3"
                accessibilityLabel="Eligible again on date"
              />
            )}
          </View>
        </View>

        <View className="bg-surface rounded-2xl border border-border">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-border">
            <Text variant="label" className="text-text-subtle uppercase">
              Spending
            </Text>
            <Pressable
              onPress={startAddSpend}
              className="flex-row items-center gap-1 px-2 py-1"
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Add spend"
            >
              <Plus size={14} color={colors.primaryStrong} />
              <Text variant="label" className="text-primary-strong">
                Add spend
              </Text>
            </Pressable>
          </View>
          {recentSpend.length > 0 ? (
            recentSpend.map((s, idx, arr) => (
              <View
                key={s.id}
                className={cn(
                  "flex-row items-center justify-between px-4 py-3",
                  idx < arr.length - 1 && "border-b border-border",
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
            ))
          ) : (
            <View className="px-4 py-5 items-center">
              <Text variant="callout" className="text-text-muted text-center">
                No spend recorded yet. Add a transaction to track progress
                toward your signup bonus.
              </Text>
            </View>
          )}
          {c.spend_entries.length > recentSpend.length ? (
            <Pressable
              onPress={() =>
                // Cast: the generated route union lags a newly-added dynamic
                // route until Metro restarts. Runtime resolution is fine.
                router.push({
                  pathname: "/card-spend/[id]" as never,
                  params: { id: c.id },
                })
              }
              className="px-4 py-3 border-t border-border items-center"
              accessibilityRole="button"
              accessibilityLabel="See all spend"
            >
              <Text variant="label" className="text-primary-strong">
                See all {c.spend_entries.length} transactions
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View className="bg-surface rounded-2xl border border-border">
          <View className="px-4 py-3 border-b border-border">
            <Text variant="label" className="text-text-subtle uppercase">
              Benefits ({product?.benefit_definitions.length ?? 0})
            </Text>
          </View>
          {(product?.benefit_definitions ?? []).map((bd, idx, arr) => {
            const cycle = c.user_benefit_cycles.find(
              (cy) =>
                cy.benefit_definition_id === bd.id &&
                cy.period_start <= todayIso &&
                cy.period_end >= todayIso,
            );
            const redeemed = c.benefit_redemptions
              .filter(
                (r) =>
                  r.benefit_definition_id === bd.id &&
                  (!cycle || r.benefit_cycle_id === cycle.id),
              )
              .reduce((sum, r) => sum + Number(r.amount), 0);
            const value =
              bd.value_per_period != null
                ? `$${bd.value_per_period}`
                : bd.annual_value != null
                  ? `$${bd.annual_value}/yr`
                  : "—";
            const last = idx === arr.length - 1;
            return (
              <Pressable
                key={bd.id}
                onPress={() =>
                  router.push({
                    pathname: "/benefit-detail/[key]" as never,
                    params: { key: `${c.id}__${bd.id}` },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`View ${bd.name}`}
                className={cn(
                  "px-4 py-3 active:bg-surface-muted",
                  !last && "border-b border-border",
                )}
              >
                <View className="flex-row items-center justify-between">
                  <Text variant="title" className="flex-1 pr-3">
                    {bd.name}
                  </Text>
                  <Text variant="callout" className="text-text-muted">
                    {value}
                  </Text>
                  <ChevronRight
                    size={16}
                    color={colors.textMuted}
                    style={{ marginLeft: 6 }}
                  />
                </View>
                <Text variant="caption" className="text-text-muted mt-1">
                  {bd.reset_frequency} · {bd.reset_basis}
                  {bd.benefit_category ? ` · ${bd.benefit_category.name}` : ""}
                  {bd.requires_enrollment ? " · enrolment required" : ""}
                </Text>
                {cycle ? (
                  <Text variant="caption" className="text-text-muted mt-1">
                    {formatPeriod(cycle.period_start, cycle.period_end)} ·{" "}
                    Redeemed ${redeemed}
                    {cycle.allotted_value != null
                      ? ` / $${cycle.allotted_value}`
                      : ""}
                    {" · "}
                    {cycle.status}
                  </Text>
                ) : (
                  <Text variant="caption" className="text-warning mt-1">
                    No active cycle
                  </Text>
                )}
              </Pressable>
            );
          })}
          {(product?.benefit_definitions.length ?? 0) === 0 && (
            <View className="px-4 py-6 items-center">
              <Text variant="callout" className="text-text-muted">
                No benefits defined for this card.
              </Text>
            </View>
          )}
        </View>

        <Button
          variant="danger"
          size="lg"
          fullWidth
          label="Remove this card"
          leftIcon={<Trash2 size={16} color="#FFFFFF" />}
          onPress={handleRemove}
        />
      </ScrollView>

      <Modal
        visible={editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(false)}
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
            <Text variant="h2" className="mb-4">
              Edit card details
            </Text>

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Nickname
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="e.g. Travel card"
              placeholderTextColor={colors.textSubtle}
              value={nickname}
              onChangeText={(t) => {
                setNickname(t);
                if (editError) setEditError(null);
              }}
            />

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Last 4 digits
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="1234"
              placeholderTextColor={colors.textSubtle}
              value={lastFour}
              onChangeText={(t) => {
                setLastFour(t);
                if (editError) setEditError(null);
              }}
              keyboardType="number-pad"
              maxLength={4}
            />

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

            {editError ? (
              <Text variant="caption" className="text-error-text mb-3">
                {editError}
              </Text>
            ) : null}
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => setEditing(false)}
              />
              <Button
                variant="primary"
                label="Save"
                className="flex-1"
                loading={update.isPending}
                onPress={commitEdit}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={bonusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setBonusModal(false)}
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
            <Text variant="h2" className="mb-4">
              {bonusEditingId ? "Edit signup bonus" : "Add signup bonus"}
            </Text>

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Required spend
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="$4,000"
              placeholderTextColor={colors.textSubtle}
              value={bonusSpendField}
              onChangeText={(t) => {
                setBonusSpendField(t);
                if (bonusError) setBonusError(null);
              }}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Bonus value ({programUnitLabel(program?.unit_type)})
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder={
                program?.unit_type === "cash_back" ? "$200" : "60,000"
              }
              placeholderTextColor={colors.textSubtle}
              value={bonusValueField}
              onChangeText={(t) => {
                setBonusValueField(t);
                if (bonusError) setBonusError(null);
              }}
              keyboardType="decimal-pad"
            />

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Spend deadline
            </Text>
            <DateField
              value={bonusDeadlineField}
              onChange={setBonusDeadlineField}
              placeholder="No deadline"
              clearable
              className="mb-4"
              accessibilityLabel="Spend deadline date"
            />

            {bonusError ? (
              <Text variant="caption" className="text-error-text mb-3">
                {bonusError}
              </Text>
            ) : null}
            {bonusEditingId && bonus ? (
              bonus.is_completed ? (
                <Button
                  variant="ghost"
                  label="Mark as not earned"
                  className="mb-3 bg-surface-muted"
                  loading={updateBonus.isPending}
                  onPress={() => setBonusEarned(false)}
                />
              ) : (
                <Button
                  variant="secondary"
                  label="Mark as earned"
                  className="mb-3"
                  loading={updateBonus.isPending}
                  onPress={() => setBonusEarned(true)}
                />
              )
            ) : null}
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => setBonusModal(false)}
              />
              <Button
                variant="primary"
                label="Save"
                className="flex-1"
                loading={addBonus.isPending || updateBonus.isPending}
                onPress={commitBonus}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={spendModal}
        transparent
        animationType="fade"
        onRequestClose={() => setSpendModal(false)}
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
              Add spend
            </Text>
            <Text variant="body" className="text-text-muted mb-4">
              {bonus
                ? "Counts toward your signup bonus progress."
                : "Recorded against this card."}
            </Text>

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Amount
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="$125.40"
              placeholderTextColor={colors.textSubtle}
              value={spendAmount}
              onChangeText={(t) => {
                setSpendAmount(sanitizeAmountInput(t));
                if (spendError) setSpendError(null);
              }}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Date
            </Text>
            <View className="flex-row gap-2 mb-2">
              {[
                { label: "Today", iso: todayIso },
                { label: "Yesterday", iso: yesterdayIso },
              ].map((chip) => {
                const active = spendDate === chip.iso;
                return (
                  <Pressable
                    key={chip.label}
                    onPress={() => setSpendDate(chip.iso)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border",
                      active
                        ? "bg-primary-subtle border-primary"
                        : "bg-surface border-border",
                    )}
                  >
                    <Text
                      variant="callout"
                      className={
                        active ? "text-primary-strong" : "text-text-muted"
                      }
                    >
                      {chip.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <DateField
              value={spendDate || todayIso}
              onChange={(v) => setSpendDate(v ?? todayIso)}
              maximumDate={new Date()}
              className="mb-4"
              accessibilityLabel="Spend date"
            />

            {spendError ? (
              <Text variant="caption" className="text-error-text mb-3">
                {spendError}
              </Text>
            ) : null}
            <View className="flex-row gap-3">
              <Button
                variant="ghost"
                label="Cancel"
                className="flex-1 bg-surface-muted"
                onPress={() => setSpendModal(false)}
              />
              <Button
                variant="primary"
                label="Add"
                className="flex-1"
                loading={addSpend.isPending}
                onPress={commitSpend}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={productModal}
        transparent
        animationType="fade"
        onRequestClose={() => setProductModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl w-full max-w-md max-h-[80%] grow-0 overflow-hidden">
            <View className="px-5 pt-5 pb-3 border-b border-border">
              <Text variant="h2">Change product</Text>
              <Text variant="body" className="text-text-muted mt-1">
                Keeps your opened date, spend history, and signup bonus — only
                the benefits change.
              </Text>
            </View>
            <ScrollView
              contentContainerStyle={{ paddingVertical: 4 }}
              keyboardShouldPersistTaps="handled"
            >
              {siblingProducts.map((p, idx) => {
                const currentFee = Number(product?.annual_fee ?? 0);
                const fee = Number(p.annual_fee ?? 0);
                const dir =
                  fee > currentFee
                    ? "Upgrade"
                    : fee < currentFee
                      ? "Downgrade"
                      : "Switch";
                const last = idx === siblingProducts.length - 1;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => doChangeProduct(p.id, p.name)}
                    disabled={changeProduct.isPending}
                    accessibilityRole="button"
                    accessibilityLabel={`Change to ${p.name}`}
                    className={cn(
                      "px-5 py-3 active:bg-surface-muted",
                      !last && "border-b border-border",
                    )}
                  >
                    <View className="flex-row items-center justify-between">
                      <Text variant="title" className="flex-1 pr-3">
                        {p.name}
                      </Text>
                      <ChevronRight size={16} color={colors.textMuted} />
                    </View>
                    <Text variant="caption" className="text-text-muted mt-0.5">
                      {dir} · ${fee.toFixed(0)}/yr annual fee
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View className="px-5 py-3 border-t border-border">
              <Button
                variant="ghost"
                label="Cancel"
                className="bg-surface-muted"
                onPress={() => setProductModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      {program && walletEditOpen && programBalance != null && (
        <WalletEditModal
          open
          programName={program.name}
          unitType={program.unit_type}
          currentBalance={programBalance}
          saving={setBalance.isPending}
          onClose={() => setWalletEditOpen(false)}
          onSave={(newBalance) =>
            setBalance.mutate(
              { programId: program.id, balance: newBalance },
              {
                onSuccess: () => {
                  setWalletEditOpen(false);
                  snackbarAfterModalClose(() =>
                    snackbar.success("Balance updated"),
                  );
                },
                // Modal stays open on failure; keep the in-modal Alert.
                onError: (e) => notify("Save failed", (e as Error).message),
              },
            )
          }
        />
      )}
    </SafeAreaView>
  );
}
