// Card details — full view of one user_card with its benefits and edit
// affordances for the user-supplied metadata (nickname, last_four,
// opened_on). Reachable by tapping a held card on the Cards tab.

import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { confirmDestructive, notify } from "@/lib/dialog";
import {
  useCardDetails,
  useCurrentPortfolio,
  useRemoveUserCard,
  useUpdateUserCard,
} from "@/lib/hooks";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const { data: portfolio } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data: card, isLoading, error } = useCardDetails(id);
  const update = useUpdateUserCard(portfolioId);
  const remove = useRemoveUserCard(portfolioId);

  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [lastFour, setLastFour] = useState("");
  const [openedOn, setOpenedOn] = useState("");

  function startEdit() {
    setNickname(card?.nickname ?? "");
    setLastFour(card?.last_four ?? "");
    setOpenedOn(card?.opened_on ?? "");
    setEditing(true);
  }

  function commitEdit() {
    if (!card) return;
    const openedTrim = openedOn.trim();
    if (openedTrim && !ISO_DATE_RE.test(openedTrim)) {
      notify("Invalid date", "Use YYYY-MM-DD, or leave blank.");
      return;
    }
    if (openedTrim && Number.isNaN(new Date(openedTrim).getTime())) {
      notify("Invalid date", "That date isn't valid.");
      return;
    }
    update.mutate(
      {
        userCardId: card.id,
        patch: {
          nickname: nickname.trim() || null,
          last_four: lastFour.trim() || null,
          opened_on: openedTrim || null,
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
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !card) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-600 text-center">
            {error ? (error as Error).message : "Card not found."}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="mt-4 px-4 py-2 bg-blue-600 rounded-xl"
          >
            <Text className="text-white font-medium">Back</Text>
          </Pressable>
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
      benefit_definitions: Array<{
        id: string;
        name: string;
        value_per_period: number | null;
        annual_value: number | null;
        reset_frequency: string;
        reset_basis: string;
        requires_enrollment: boolean;
        benefit_category: { name: string } | null;
      }>;
    } | null;
    user_benefit_cycles: Array<{
      id: string;
      benefit_definition_id: string;
      period_start: string;
      period_end: string;
      allotted_value: number | null;
      status: string;
    }>;
    benefit_redemptions: Array<{
      id: string;
      benefit_definition_id: string;
      benefit_cycle_id: string;
      amount: number;
    }>;
  };

  const product = c.card_product;
  const todayIso = new Date().toISOString().slice(0, 10);
  const annualFee = product?.annual_fee != null ? `$${Number(product.annual_fee).toFixed(0)}/yr` : null;

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4 flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <ArrowLeft size={22} color="#374151" />
        </Pressable>
        <View className="flex-1">
          <Text className="text-xl font-bold text-gray-900" numberOfLines={1}>
            {product?.name ?? "Card"}
          </Text>
          <Text className="text-xs text-gray-500 mt-0.5" numberOfLines={1}>
            {product?.issuer?.name}
            {product?.network ? ` · ${product.network}` : ""}
            {annualFee ? ` · ${annualFee}` : ""}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="bg-white rounded-2xl border border-gray-200">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
            <Text className="text-xs text-gray-500 uppercase tracking-wide">
              Details
            </Text>
            <Pressable
              onPress={startEdit}
              className="flex-row items-center gap-1 px-2 py-1"
              hitSlop={4}
            >
              <Pencil size={13} color="#2563eb" />
              <Text className="text-sm text-blue-600 font-medium">Edit</Text>
            </Pressable>
          </View>
          <DetailRow label="Nickname" value={c.nickname ?? "—"} />
          <DetailRow label="Last 4" value={c.last_four ?? "—"} />
          <DetailRow label="Opened on" value={formatOpenedOn(c.opened_on)} last />
        </View>

        <View className="bg-white rounded-2xl border border-gray-200">
          <View className="px-4 py-3 border-b border-gray-100">
            <Text className="text-xs text-gray-500 uppercase tracking-wide">
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
                className={`px-4 py-3 ${last ? "" : "border-b border-gray-100"}`}
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-medium text-gray-900 flex-1 pr-3">
                    {bd.name}
                  </Text>
                  <Text className="text-sm text-gray-700">{value}</Text>
                </View>
                <Text className="text-xs text-gray-500 mt-1">
                  {bd.reset_frequency} · {bd.reset_basis}
                  {bd.benefit_category ? ` · ${bd.benefit_category.name}` : ""}
                  {bd.requires_enrollment ? " · enrolment required" : ""}
                </Text>
                {cycle ? (
                  <Text className="text-xs text-gray-600 mt-1">
                    {formatPeriod(cycle.period_start, cycle.period_end)} ·{" "}
                    Redeemed ${redeemed}
                    {cycle.allotted_value != null
                      ? ` / $${cycle.allotted_value}`
                      : ""}
                    {" · "}
                    {cycle.status}
                  </Text>
                ) : (
                  <Text className="text-xs text-orange-600 mt-1">
                    No active cycle
                  </Text>
                )}
              </View>
            );
          })}
          {(product?.benefit_definitions.length ?? 0) === 0 && (
            <View className="px-4 py-6 items-center">
              <Text className="text-sm text-gray-500">
                No benefits defined for this card.
              </Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={handleRemove}
          className="bg-white rounded-2xl border border-red-200 px-4 py-4 flex-row items-center justify-center gap-2"
        >
          <Trash2 size={16} color="#dc2626" />
          <Text className="text-red-600 font-medium">Remove this card</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="bg-white rounded-2xl p-5 w-full max-w-md">
            <Text className="text-lg font-semibold text-gray-900 mb-4">
              Edit card details
            </Text>

            <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Nickname
            </Text>
            <TextInput
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-gray-900"
              placeholder="e.g. Travel card"
              placeholderTextColor="#9ca3af"
              value={nickname}
              onChangeText={setNickname}
            />

            <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Last 4 digits
            </Text>
            <TextInput
              className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-gray-900"
              placeholder="1234"
              placeholderTextColor="#9ca3af"
              value={lastFour}
              onChangeText={setLastFour}
              keyboardType="number-pad"
              maxLength={4}
            />

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
            />

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => setEditing(false)}
                className="flex-1 py-3 rounded-xl bg-gray-100 items-center"
              >
                <Text className="text-gray-700 font-medium">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitEdit}
                disabled={update.isPending}
                className={`flex-1 py-3 rounded-xl items-center ${
                  update.isPending ? "bg-gray-300" : "bg-blue-600"
                }`}
              >
                <Text className="text-white font-medium">
                  {update.isPending ? "Saving..." : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between px-4 py-3 ${
        last ? "" : "border-b border-gray-100"
      }`}
    >
      <Text className="text-sm text-gray-600">{label}</Text>
      <Text className="text-sm text-gray-900 font-medium">{value}</Text>
    </View>
  );
}
