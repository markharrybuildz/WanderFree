// Benefit detail — full view of one benefit on one card, reached by
// long-pressing a row on the Benefits tab. Reuses the cached useBenefits
// list (no extra query) and matches on user_card_id + benefit_definition_id,
// which are encoded together in the `key` route param as "cardId__defId".

import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/dialog";
import {
  useBenefits,
  useCurrentPortfolio,
  useToggleBenefitRedeemed,
} from "@/lib/hooks";
import { colors } from "@/lib/theme";
import { type UserVisibleBenefit } from "@/lib/types";

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function splitNameValue(b: UserVisibleBenefit): { title: string; value: number | null } {
  const m = b.name.match(/^\$\s?([\d,]+(?:\.\d+)?)\s+(.+)$/);
  if (m) return { title: m[2].trim(), value: parseFloat(m[1].replace(/,/g, "")) };
  return { title: b.name, value: b.annual_value ?? b.value_per_period ?? null };
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function humanize(s?: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function BenefitDetailScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const [cardId, defId] = (key ?? "").split("__");

  const { data: portfolio } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;
  const { data: benefits, isLoading } = useBenefits(portfolioId);
  const toggle = useToggleBenefitRedeemed(portfolioId);

  const b = benefits?.find(
    (x) => x.user_card_id === cardId && x.benefit_definition_id === defId,
  );

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!b) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="body" className="text-text-muted text-center mb-4">
            This benefit is no longer available.
          </Text>
          <Button variant="primary" label="Back" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const { title, value } = splitNameValue(b);
  const allotted = b.cycle?.allotted_value ?? b.value_per_period ?? null;
  const redeemed =
    b.fully_redeemed && allotted != null ? allotted : b.redeemed_amount;
  const remaining = allotted != null ? Math.max(0, allotted - redeemed) : null;
  const pct =
    allotted && allotted > 0
      ? Math.min(100, Math.round((redeemed / allotted) * 100))
      : b.fully_redeemed
        ? 100
        : 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4 flex-row items-center gap-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back to benefits"
        >
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <View className="flex-1">
          <Text variant="h2" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="caption" className="text-text-muted mt-0.5" numberOfLines={1}>
            {b.card_name}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {allotted != null && (
          <View className="bg-surface rounded-2xl border border-border p-4">
            <Text variant="label" className="text-text-subtle uppercase mb-2">
              This cycle
            </Text>
            <View className="flex-row items-end justify-between">
              <Text variant="h1">{usd(remaining ?? 0)}</Text>
              <Text variant="caption" className="text-text-muted mb-1">
                {usd(redeemed)} of {usd(allotted)} used
              </Text>
            </View>
            <View className="h-2 rounded-full bg-surface-muted overflow-hidden mt-3">
              <View
                className="h-2 rounded-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </View>
            {b.cycle && (
              <Text variant="caption" className="text-text-muted mt-2">
                {fmtDate(b.cycle.period_start)} – {fmtDate(b.cycle.period_end)} ·{" "}
                {humanize(b.cycle.status)}
              </Text>
            )}
          </View>
        )}

        <View className="bg-surface rounded-2xl border border-border">
          <DetailRow label="Category" value={b.benefit_category?.name ?? "—"} />
          <DetailRow label="Card" value={b.card_name} />
          <DetailRow
            label="Benefit value"
            value={value != null ? usd(value) : "Perk"}
          />
          {b.value_per_period != null && (
            <DetailRow label="Per period" value={usd(b.value_per_period)} />
          )}
          <DetailRow label="Resets" value={humanize(b.reset_frequency)} last />
        </View>

        <Button
          variant={b.fully_redeemed ? "secondary" : "primary"}
          size="lg"
          fullWidth
          label={b.fully_redeemed ? "Mark as available" : "Mark as used"}
          onPress={() =>
            toggle.mutate(
              { benefit: b, redeem: !b.fully_redeemed },
              { onError: (e) => notify("Update failed", (e as Error).message) },
            )
          }
        />
      </ScrollView>
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
      className={cn(
        "flex-row items-center justify-between px-4 py-3",
        !last && "border-b border-border",
      )}
    >
      <Text variant="callout" className="text-text-muted">
        {label}
      </Text>
      <Text variant="title" className="shrink pl-3 text-right" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
