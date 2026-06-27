// Benefits screen.
//
// Layout (top → bottom):
//   1. Value hero — $ left to redeem, total tracked, $ expiring soon, progress.
//   2. Filter bar — segmented expiry horizon + Category / Card sheet pickers.
//   3. Urgency-grouped list (SectionList): Expiring this week / This month /
//      Later / Redeemed. Each row shows $ value (amber when expiring soon),
//      an "Ends in N days" label, and a tap-to-redeem checkbox.
//
// Dollar math uses each benefit's cap (cycle.allotted_value, falling back to
// value_per_period / annual_value) and its redeemed_amount. Benefits with no
// dollar cap are still listed but don't contribute to the $ totals.

import { LinearGradient } from "expo-linear-gradient";
import {
  Check,
  ChevronDown,
  CreditCard,
  Fuel,
  type LucideIcon,
  Plane,
  ShoppingCart,
  Utensils,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SectionList,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/dialog";
import {
  useBenefits,
  useCurrentPortfolio,
  useEnsureCycles,
  useToggleBenefitRedeemed,
} from "@/lib/hooks";
import { colors } from "@/lib/theme";
import { type UserVisibleBenefit } from "@/lib/types";

type ExpiryFilter = "all" | "week" | "month" | "quarter";

const EXPIRY_LABELS: Record<ExpiryFilter, string> = {
  all: "All",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

const DAY_MS = 1000 * 60 * 60 * 24;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  dining: Utensils,
  travel: Plane,
  flights: Plane,
  hotels: Plane,
  gas: Fuel,
  ev_charging: Fuel,
  grocery: ShoppingCart,
  wholesale_club: ShoppingCart,
};

function iconFor(name?: string | null): LucideIcon {
  return CATEGORY_ICONS[(name ?? "").toLowerCase()] ?? CreditCard;
}

/** The benefit's dollar cap for the current cycle, best-available source. */
function benefitCap(b: UserVisibleBenefit): number | null {
  return b.cycle?.allotted_value ?? b.value_per_period ?? b.annual_value ?? null;
}

/** Fractional days until the cycle ends (null when no end date). */
function daysUntil(end?: string | null): number | null {
  if (!end) return null;
  return (new Date(end).getTime() - Date.now()) / DAY_MS;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function endLabel(b: UserVisibleBenefit): string {
  if (b.fully_redeemed) return "Redeemed";
  const end = b.cycle?.period_end;
  if (!end) return "No expiry";
  const d = daysUntil(end);
  if (d == null) return "No expiry";
  if (d <= 0) return "Expired";
  if (d <= 7) {
    const n = Math.ceil(d);
    return `Ends in ${n} day${n === 1 ? "" : "s"}`;
  }
  return `Ends ${new Date(end).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export default function BenefitsScreen() {
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();
  const portfolioId = portfolio?.id;

  const { data: benefits, isLoading, error, refetch, isFetching } = useBenefits(portfolioId);
  const toggle = useToggleBenefitRedeemed(portfolioId);
  const ensure = useEnsureCycles(portfolioId);

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");

  useEffect(() => {
    if (portfolioId) ensure.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of benefits ?? []) {
      if (b.benefit_category?.name) set.add(b.benefit_category.name);
    }
    return Array.from(set).sort();
  }, [benefits]);

  const cards = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of benefits ?? []) map.set(b.user_card_id, b.card_name);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [benefits]);

  // Portfolio-wide $ summary (independent of the active filters).
  const hero = useMemo(() => {
    let cap = 0;
    let got = 0;
    let soon = 0;
    for (const b of benefits ?? []) {
      const v = benefitCap(b);
      if (v == null) continue;
      const g = b.fully_redeemed ? v : Math.min(b.redeemed_amount, v);
      cap += v;
      got += g;
      const remaining = Math.max(0, v - g);
      const d = daysUntil(b.cycle?.period_end);
      if (!b.fully_redeemed && remaining > 0 && d != null && d <= 30) {
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
    const horizons: Record<ExpiryFilter, number> = {
      all: Infinity,
      week: 7,
      month: 30,
      quarter: 90,
    };
    const horizon = horizons[expiryFilter];
    return list.filter((b) => {
      if (categoryFilter && b.benefit_category?.name !== categoryFilter) return false;
      if (cardFilter && b.user_card_id !== cardFilter) return false;
      if (expiryFilter !== "all") {
        const d = daysUntil(b.cycle?.period_end);
        if (d == null || d < 0 || d > horizon) return false;
      }
      return true;
    });
  }, [benefits, categoryFilter, cardFilter, expiryFilter]);

  // Group into urgency buckets. Within a bucket, sort by soonest expiry.
  const sections = useMemo(() => {
    const week: UserVisibleBenefit[] = [];
    const month: UserVisibleBenefit[] = [];
    const later: UserVisibleBenefit[] = [];
    const redeemed: UserVisibleBenefit[] = [];
    for (const b of filtered) {
      if (b.fully_redeemed) {
        redeemed.push(b);
        continue;
      }
      const d = daysUntil(b.cycle?.period_end);
      if (d != null && d <= 7) week.push(b);
      else if (d != null && d <= 30) month.push(b);
      else later.push(b);
    }
    const byExpiry = (a: UserVisibleBenefit, b: UserVisibleBenefit) => {
      const ad = daysUntil(a.cycle?.period_end) ?? Infinity;
      const bd = daysUntil(b.cycle?.period_end) ?? Infinity;
      return ad - bd || a.name.localeCompare(b.name);
    };
    week.sort(byExpiry);
    month.sort(byExpiry);
    later.sort(byExpiry);

    const out: { title: string; tone?: "amber" | "muted"; data: UserVisibleBenefit[] }[] = [];
    if (week.length) out.push({ title: "Expiring this week", tone: "amber", data: week });
    if (month.length) out.push({ title: "This month", data: month });
    if (later.length) out.push({ title: "Later", data: later });
    if (redeemed.length) out.push({ title: "Redeemed", tone: "muted", data: redeemed });
    return out;
  }, [filtered]);

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
            You&apos;re not a member of any portfolio yet.{"\n"}
            Create one in Supabase to get started.
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
      <View className="bg-surface border-b border-border px-4 py-4">
        <Text variant="display">Benefits</Text>
        <Text variant="caption" className="text-text-muted mt-1">
          {isFetching ? "Refreshing..." : "Track your rewards"}
        </Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(b) => `${b.user_card_id}:${b.benefit_definition_id}`}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View className="gap-3 mb-1">
            <Hero left={hero.left} cap={hero.cap} soon={hero.soon} pct={hero.pct} />
            <View className="gap-2">
              <Segmented
                value={expiryFilter}
                onChange={setExpiryFilter}
                options={(Object.keys(EXPIRY_LABELS) as ExpiryFilter[]).map((k) => ({
                  key: k,
                  label: EXPIRY_LABELS[k],
                }))}
              />
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
                  label="Card"
                  value={cardFilter}
                  onChange={setCardFilter}
                  options={[
                    { key: null, label: "All" },
                    ...cards.map((c) => ({ key: c.id, label: c.name })),
                  ]}
                />
              </View>
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
        renderItem={({ item }) => (
          <BenefitRow
            b={item}
            onToggle={() =>
              toggle.mutate(
                { benefit: item, redeem: !item.fully_redeemed },
                { onError: (e) => notify("Redemption failed", (e as Error).message) },
              )
            }
          />
        )}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text variant="body" className="text-text-muted text-center">
              {categoryFilter || cardFilter || expiryFilter !== "all"
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

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
}) {
  return (
    <View className="flex-row bg-surface-muted rounded-full p-1">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            className={cn(
              "flex-1 items-center py-1.5 rounded-full",
              active && "bg-primary-strong",
            )}
          >
            <Text
              variant="callout"
              className={active ? "text-white" : "text-text-muted"}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-overlay/40 justify-end" onPress={onClose}>
        <Pressable
          className="bg-surface rounded-t-3xl px-5 pt-5 pb-10"
          onPress={(e) => e.stopPropagation()}
        >
          <Text variant="h2" className="mb-2">{title}</Text>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function BenefitRow({
  b,
  onToggle,
}: {
  b: UserVisibleBenefit;
  onToggle: () => void;
}) {
  const Icon = iconFor(b.benefit_category?.name);
  const cap = benefitCap(b);
  const d = daysUntil(b.cycle?.period_end);
  const soon = !b.fully_redeemed && d != null && d >= 0 && d <= 7;
  const valueStr = cap != null ? usd(cap) : "—";

  return (
    <Pressable
      onPress={onToggle}
      className={cn(
        "bg-surface rounded-2xl p-3.5 flex-row items-center border border-border",
        b.fully_redeemed && "opacity-60",
      )}
    >
      <View className="p-2.5 bg-surface-muted rounded-xl">
        <Icon size={20} color={colors.textMuted} />
      </View>

      <View className="flex-1 ml-3 mr-2">
        <Text
          variant="title"
          numberOfLines={1}
          className={b.fully_redeemed ? "text-text-muted line-through" : "text-text"}
        >
          {b.name}
        </Text>
        <Text variant="caption" numberOfLines={1} className="text-text-muted mt-0.5">
          {b.card_name}
        </Text>
      </View>

      <View className="items-end mr-3">
        <Text variant="title" className={soon ? "text-warning" : "text-text"}>
          {valueStr}
        </Text>
        <Text
          variant="caption"
          className={cn("mt-0.5", soon ? "text-warning" : "text-text-subtle")}
        >
          {endLabel(b)}
        </Text>
      </View>

      <View
        className={cn(
          "w-7 h-7 rounded-full items-center justify-center border-2",
          b.fully_redeemed
            ? "bg-success border-success"
            : "border-accent bg-transparent",
        )}
      >
        {b.fully_redeemed && <Check size={15} color="white" />}
      </View>
    </Pressable>
  );
}
