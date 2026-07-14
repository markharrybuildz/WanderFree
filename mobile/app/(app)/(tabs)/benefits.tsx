// Benefits screen.
//
// Layout (top → bottom):
//   1. Value hero — $ left to redeem, total tracked, $ expiring soon, progress.
//   2. Search (header) + filter bar — Category and Availability sheet
//      pickers.
//   3. Urgency-grouped list (SectionList): Expiring this week / This month /
//      Later / Redeemed. Each row: a colored category icon, the benefit name
//      (leading "$" split into a value pill), and an amber "N days left" tag
//      when expiring soon. Tap a row to open the benefit detail screen,
//      where redemption is marked — no one-tap completion from the list.
//
// Dollar math uses each benefit's cap (cycle.allotted_value, falling back to
// value_per_period / annual_value) and its redeemed_amount. Benefits with no
// dollar cap are still listed but don't contribute to the $ totals.

import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { Check, ChevronDown, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  SectionList,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { BenefitRow, daysUntil } from "@/components/BenefitRow";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { benefitValue, splitNameValue, usd } from "@/lib/format";
import {
  useBenefits,
  useCurrentPortfolio,
  useEnsureCycles,
} from "@/lib/hooks";
import { colors, fonts } from "@/lib/theme";
import { type UserVisibleBenefit } from "@/lib/types";

type AvailabilityFilter = "available" | "redeemed";

/** "Available" = still actionable this cycle: not redeemed and the period
 *  hasn't ended. "Redeemed" = fully redeemed. Expired-but-unredeemed
 *  benefits are neither, so they only appear under "All". */
function matchesAvailability(
  b: UserVisibleBenefit,
  filter: AvailabilityFilter,
): boolean {
  if (filter === "redeemed") return b.fully_redeemed;
  const d = daysUntil(b.cycle?.period_end);
  return !b.fully_redeemed && (d == null || d >= 0);
}

export default function BenefitsScreen() {
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data: benefits, isLoading, error, refetch, isFetching } = useBenefits(portfolioId);
  const ensure = useEnsureCycles(portfolioId);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [availabilityFilter, setAvailabilityFilter] =
    useState<AvailabilityFilter | null>(null);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    if (portfolioId) ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  // Tab screens stay mounted, so an open keyboard would otherwise survive a
  // tab switch and greet the user on their way back in.
  useFocusEffect(
    useCallback(() => {
      return () => Keyboard.dismiss();
    }, []),
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of benefits ?? []) {
      if (b.benefit_category?.name) set.add(b.benefit_category.name);
    }
    return Array.from(set).sort();
  }, [benefits]);

  // Portfolio-wide $ summary (independent of the active filters).
  const hero = useMemo(() => {
    let cap = 0;
    let got = 0;
    let soon = 0;
    for (const b of benefits ?? []) {
      const v = benefitValue(b);
      if (v == null) continue;
      const g = b.fully_redeemed ? v : Math.min(b.redeemed_amount, v);
      cap += v;
      got += g;
      const remaining = Math.max(0, v - g);
      const d = daysUntil(b.cycle?.period_end);
      if (!b.fully_redeemed && remaining > 0 && d != null && d >= 0 && d <= 30) {
        soon += remaining;
      }
    }
    return {
      cap,
      left: Math.max(0, cap - got),
      soon,
      pct: cap > 0 ? Math.round((got / cap) * 100) : 0,
    };
  }, [benefits]);

  const filtered = useMemo(() => {
    const list = benefits ?? [];
    // Word-wise search: every term must appear in the benefit name, card
    // name, or category.
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((b) => {
      if (categoryFilter && b.benefit_category?.name !== categoryFilter) return false;
      if (availabilityFilter && !matchesAvailability(b, availabilityFilter)) {
        return false;
      }
      if (terms.length > 0) {
        const haystack =
          `${splitNameValue(b).title} ${b.name} ${b.card_name} ${b.benefit_category?.name ?? ""}`.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return false;
      }
      return true;
    });
  }, [benefits, categoryFilter, availabilityFilter, search]);

  // Group into urgency buckets. Within a bucket, sort by soonest expiry.
  const sections = useMemo(() => {
    const week: UserVisibleBenefit[] = [];
    const month: UserVisibleBenefit[] = [];
    const later: UserVisibleBenefit[] = [];
    const expired: UserVisibleBenefit[] = [];
    const redeemed: UserVisibleBenefit[] = [];
    // Parse each period_end once, then reuse it in the sort comparator.
    const days = new Map<UserVisibleBenefit, number>();
    for (const b of filtered) {
      const d = daysUntil(b.cycle?.period_end);
      days.set(b, d ?? Infinity);
      if (b.fully_redeemed) {
        redeemed.push(b);
        continue;
      }
      // Past period_end but never redeemed: a missed benefit. Give it its own
      // terminal bucket instead of floating it to the top of "Later".
      if (d != null && d < 0) expired.push(b);
      else if (d != null && d <= 7) week.push(b);
      else if (d != null && d <= 30) month.push(b);
      else later.push(b);
    }
    const byExpiry = (a: UserVisibleBenefit, b: UserVisibleBenefit) =>
      (days.get(a) ?? Infinity) - (days.get(b) ?? Infinity) ||
      a.name.localeCompare(b.name);
    week.sort(byExpiry);
    month.sort(byExpiry);
    later.sort(byExpiry);
    // Most-recently-expired first (−1 before −30).
    expired.sort((a, b) => (days.get(b) ?? 0) - (days.get(a) ?? 0));

    const out: { title: string; tone?: "amber" | "muted"; data: UserVisibleBenefit[] }[] = [];
    if (week.length) out.push({ title: "Expiring this week", tone: "amber", data: week });
    if (month.length) out.push({ title: "This month", data: month });
    if (later.length) out.push({ title: "Later", data: later });
    if (expired.length) out.push({ title: "Expired", tone: "muted", data: expired });
    if (redeemed.length) out.push({ title: "Redeemed", tone: "muted", data: redeemed });
    return out;
  }, [filtered]);

  // Stable callback so the memoized rows don't re-render on unrelated state.
  const handleOpen = useCallback((b: UserVisibleBenefit) => {
    router.push({
      pathname: "/benefit-detail/[key]" as never,
      params: { key: `${b.user_card_id}__${b.benefit_definition_id}` },
    });
  }, []);

  if (portfolioLoading || isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
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
          <Text variant="display">Benefits</Text>
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

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-bg">
        <View className="flex-1 items-center justify-center px-6">
          <Text variant="body" className="text-error-text text-center mb-4">
            {(error as Error).message}
          </Text>
          <Button variant="primary" label="Retry" onPress={() => refetch()} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 pt-4 pb-3">
        <Text variant="display">Benefits</Text>
        <Text variant="caption" className="text-text-muted mt-1">
          {isFetching ? "Refreshing..." : "Track your rewards"}
        </Text>
        <View className="flex-row items-center mt-3 gap-2">
          <View className="flex-1 flex-row items-center bg-surface-muted rounded-xl px-3">
            <Search size={16} color={colors.textMuted} />
            <TextInput
              className="flex-1 px-2 py-2.5 text-text"
              style={{ fontFamily: fonts.regular, fontSize: 15 }}
              placeholder="Search benefits, cards, categories"
              placeholderTextColor={colors.textSubtle}
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Search benefits"
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

      <SectionList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        sections={sections}
        keyExtractor={(b) => `${b.user_card_id}:${b.benefit_definition_id}`}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View className="gap-3 mb-1">
            <Hero left={hero.left} cap={hero.cap} soon={hero.soon} pct={hero.pct} />
            <View className="flex-row gap-2">
              <Dropdown
                label="Category"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { key: null, label: "All" },
                  ...categories.map((c) => ({ key: c, label: c })),
                ]}
              />
              <Dropdown
                label="Show"
                value={availabilityFilter}
                onChange={setAvailabilityFilter}
                options={[
                  { key: null, label: "All" },
                  { key: "available", label: "Available" },
                  { key: "redeemed", label: "Redeemed" },
                ]}
              />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-center gap-2 mt-3 mb-0.5">
            {section.tone === "amber" && (
              <View className="w-2 h-2 rounded-full bg-warning-fill" />
            )}
            <Text
              variant="label"
              className={cn(
                "uppercase",
                section.tone === "muted" ? "text-text-subtle" : "text-text-muted",
              )}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => <BenefitRow b={item} onOpen={handleOpen} />}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text variant="body" className="text-text-muted text-center">
              {categoryFilter || availabilityFilter || search.trim()
                ? "No benefits match the current filters."
                : "No benefits to show yet.\nAdd a card on the Cards tab to get started."}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({
  left,
  cap,
  soon,
  pct,
}: {
  left: number;
  cap: number;
  soon: number;
  pct: number;
}) {
  return (
    <LinearGradient
      colors={[colors.primary, colors.primaryStrong]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 20, padding: 20 }}
    >
      {cap > 0 ? (
        <>
          <Text variant="display" className="text-white">
            {usd(left)} left to redeem
          </Text>
          <Text variant="callout" className="text-white/90 mt-1">
            of {usd(cap)} in credits
            {soon > 0 ? `  ·  ${usd(soon)} expiring soon` : ""}
          </Text>
          <View className="h-2 rounded-full bg-white/30 mt-4 overflow-hidden">
            <View
              className="h-2 rounded-full bg-white"
              style={{ width: `${pct}%` }}
            />
          </View>
          <Text variant="caption" className="text-white/80 mt-1.5">
            {pct}% redeemed
          </Text>
        </>
      ) : (
        <>
          <Text variant="h1" className="text-white">
            Track your rewards
          </Text>
          <Text variant="callout" className="text-white/90 mt-1">
            Your benefits don&apos;t have dollar caps to total up yet.
          </Text>
        </>
      )}
    </LinearGradient>
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

function Dropdown<T extends string | null>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value)?.label ?? "All";
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-1 flex-row items-center justify-between px-3 py-2.5 rounded-full bg-surface border border-border"
      >
        <Text variant="callout" numberOfLines={1} className="flex-1">
          <Text variant="callout" className="text-text-muted">{label}: </Text>
          {current}
        </Text>
        <ChevronDown size={15} color={colors.textMuted} />
      </Pressable>

      <SheetModal open={open} title={label} onClose={() => setOpen(false)}>
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={String(o.key)}
              onPress={() => {
                onChange(o.key);
                setOpen(false);
              }}
              className="flex-row items-center justify-between py-3 border-b border-border"
            >
              <Text
                variant="body"
                className={active ? "text-primary-strong" : "text-text"}
              >
                {o.label}
              </Text>
              {active && <Check size={18} color={colors.primaryStrong} />}
            </Pressable>
          );
        })}
      </SheetModal>
    </>
  );
}

function SheetModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Android 15 draws edge-to-edge, so the sheet needs the real bottom inset
  // rather than fixed padding.
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-overlay/40 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl px-5 pt-5"
          style={{ paddingBottom: Math.max(insets.bottom, 24) + 16 }}
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="h2" className="mb-2">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

