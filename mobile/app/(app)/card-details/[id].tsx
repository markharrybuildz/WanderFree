// Card details — full view of one user_card with its benefits, signup-bonus
// tracking, manual spend entries, and edit affordances for the user-supplied
// metadata (nickname, last_four, opened_on). Reachable by tapping a held
// card on the Cards tab or a row on Home.

import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { DateField } from "@/components/ui/DateField";
import { DetailRow } from "@/components/ui/DetailRow";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { confirmDestructive, notify } from "@/lib/dialog";
import { fmtDate, localIsoDay, usd } from "@/lib/format";
import {
  useAddSignupBonus,
  useAddSpendEntry,
  useCardDetails,
  useCurrentPortfolio,
  useRemoveUserCard,
  useUpdateSignupBonus,
  useUpdateUserCard,
} from "@/lib/hooks";
import { colors, fonts } from "@/lib/theme";

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

function formatPeriod(start: string, end: string): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function CardDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Android 15 draws edge-to-edge; pad scroll content past the gesture bar.
  const insets = useSafeAreaInsets();
  const { data: portfolio } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data: card, isLoading, error } = useCardDetails(id);
  const update = useUpdateUserCard(portfolioId);
  const remove = useRemoveUserCard(portfolioId);
  const addBonus = useAddSignupBonus();
  const updateBonus = useUpdateSignupBonus();
  const addSpend = useAddSpendEntry();

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [lastFour, setLastFour] = useState("");
  const [openedOn, setOpenedOn] = useState<string | null>(null);

  // Signup-bonus add/edit modal state. `bonusEditingId` is null when adding.
  const [bonusModal, setBonusModal] = useState(false);
  const [bonusEditingId, setBonusEditingId] = useState<string | null>(null);
  const [bonusSpendField, setBonusSpendField] = useState("");
  const [bonusValueField, setBonusValueField] = useState("");
  const [bonusDeadlineField, setBonusDeadlineField] = useState<string | null>(null);

  // Add-spend modal state.
  const [spendModal, setSpendModal] = useState(false);
  const [spendAmount, setSpendAmount] = useState("");
  const [spendDate, setSpendDate] = useState("");

  function startEdit() {
    setNickname(card?.nickname ?? "");
    setLastFour(card?.last_four ?? "");
    setOpenedOn(card?.opened_on ?? null);
    setEditing(true);
  }

  function commitEdit() {
    if (!card) return;
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
        onSuccess: () => setEditing(false),
        onError: (e) => notify("Update failed", (e as Error).message),
      },
    );
  }

  function handleRemove() {
    if (!card) return;
    confirmDestructive({
      title: "Remove card?",
      message:
        "Your benefit cycles and redemption history for this card will be removed.",
      confirmLabel: "Remove",
      onConfirm: () =>
        remove.mutate(card.id, {
          onSuccess: () => router.back(),
          onError: (e) => notify("Remove failed", (e as Error).message),
        }),
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
          <Button variant="primary" label="Back" onPress={() => router.back()} />
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
    card_product: {
      name: string;
      network: string | null;
      annual_fee: number;
      issuer: { name: string } | null;
      rewards_program: { name: string; unit_type: string } | null;
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
  // Local calendar days — toISOString() would shift the day in US timezones,
  // and fixed-ms subtraction breaks across DST; step by date parts instead.
  const todayIso = localIsoDay();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = localIsoDay(yesterday);
  const annualFee = product?.annual_fee != null ? `$${Number(product.annual_fee).toFixed(0)}/yr` : null;

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
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at))
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
    setBonusValueField(bonus?.bonus_value != null ? String(bonus.bonus_value) : "");
    setBonusDeadlineField(bonus?.spend_deadline ?? null);
    setBonusModal(true);
  }

  function commitBonus() {
    if (!card) return;
    const requiredSpend = parseAmount(bonusSpendField);
    if (requiredSpend == null) {
      notify("Invalid amount", "Required spend must be a positive number.");
      return;
    }
    const value = parseAmount(bonusValueField);
    if (bonusValueField.trim() && value == null) {
      notify("Invalid amount", "Bonus value must be a positive number.");
      return;
    }
    const deadline = bonusDeadlineField;
    const onDone = {
      onSuccess: () => setBonusModal(false),
      onError: (e: Error) => notify("Save failed", e.message),
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

  function startAddSpend() {
    setSpendAmount("");
    setSpendDate(todayIso);
    setSpendModal(true);
  }

  function commitSpend() {
    if (!card) return;
    const amount = parseAmount(spendAmount);
    if (amount == null) {
      notify("Invalid amount", "Enter a positive dollar amount.");
      return;
    }
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
        onSuccess: () => setSpendModal(false),
        onError: (e) => notify("Save failed", (e as Error).message),
      },
    );
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
          <Text variant="caption" className="text-text-muted mt-0.5" numberOfLines={1}>
            {product?.issuer?.name}
            {product?.network ? ` · ${product.network}` : ""}
            {annualFee ? ` · ${annualFee}` : ""}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 24 }}
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
              <Text variant="label" className="text-primary-strong">Edit</Text>
            </Pressable>
          </View>
          <DetailRow label="Nickname" value={c.nickname ?? "—"} />
          <DetailRow label="Last 4" value={c.last_four ?? "—"} />
          <DetailRow label="Opened on" value={formatOpenedOn(c.opened_on)} last />
        </View>

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
                    {usd(Math.max(0, Number(bonus.required_spend) - bonusSpent))} to go
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
                  ? `Earns ${usd(Number(bonus.bonus_value))}`
                  : "Bonus value not set"}
                {bonus.spend_deadline
                  ? ` · spend by ${fmtDate(bonus.spend_deadline)}`
                  : ""}
              </Text>
            </View>
          ) : (
            <View className="px-4 py-5 items-center">
              <Text variant="callout" className="text-text-muted text-center">
                No signup bonus tracked. Add one to follow your progress
                toward the welcome offer.
              </Text>
            </View>
          )}
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
                <Text variant="title">{usd(Number(s.amount))}</Text>
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
              <View
                key={bd.id}
                className={cn("px-4 py-3", !last && "border-b border-border")}
              >
                <View className="flex-row items-center justify-between">
                  <Text variant="title" className="flex-1 pr-3">
                    {bd.name}
                  </Text>
                  <Text variant="callout" className="text-text-muted">{value}</Text>
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
              </View>
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
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
            <Text variant="h2" className="mb-4">Edit card details</Text>

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Nickname
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="e.g. Travel card"
              placeholderTextColor={colors.textSubtle}
              value={nickname}
              onChangeText={setNickname}
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
              onChangeText={setLastFour}
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
          </View>
        </View>
      </Modal>

      <Modal
        visible={bonusModal}
        transparent
        animationType="fade"
        onRequestClose={() => setBonusModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
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
              onChangeText={setBonusSpendField}
              keyboardType="decimal-pad"
              autoFocus
            />

            <Text variant="label" className="text-text-subtle uppercase mb-2">
              Bonus value
            </Text>
            <TextInput
              className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 16 }}
              placeholder="$800"
              placeholderTextColor={colors.textSubtle}
              value={bonusValueField}
              onChangeText={setBonusValueField}
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
          </View>
        </View>
      </Modal>

      <Modal
        visible={spendModal}
        transparent
        animationType="fade"
        onRequestClose={() => setSpendModal(false)}
      >
        <View className="flex-1 items-center justify-center bg-overlay/40 px-6">
          <View className="bg-surface rounded-2xl p-5 w-full max-w-md">
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
              onChangeText={setSpendAmount}
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
                      className={active ? "text-primary-strong" : "text-text-muted"}
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
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

