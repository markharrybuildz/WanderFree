// Benefits screen.
//
// Layout (top → bottom):
//   1. Value hero — $ left to redeem, total tracked, $ expiring soon, progress.
//   2. Filter bar — segmented expiry horizon + Category / Card sheet pickers.
//   3. Urgency-grouped list (SectionList): Expiring this week / This month /
//      Later / Redeemed. Each row: a colored category icon, the benefit name
//      (leading "$" split into a value pill), and an amber "N days left" tag
//      when expiring soon. Tap a row to mark it used; long-press opens the
//      benefit detail screen.
//
// Dollar math uses each benefit's cap (cycle.allotted_value, falling back to
// value_per_period / annual_value) and its redeemed_amount. Benefits with no
// dollar cap are still listed but don't contribute to the $ totals.

import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Car,
  Check,
  ChevronDown,
  Fuel,
  HeartPulse,
  type LucideIcon,
  Plane,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Ticket,
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

// Category → colored icon. Matched by keyword so both enum-style keys
// ("wholesale_club") and display names ("Groceries") resolve.
const CAT_STYLES: { test: RegExp; Icon: LucideIcon; bg: string; fg: string }[] = [
  { test: /dining|restaurant|food/, Icon: Utensils, bg: "bg-amber-100", fg: "#B45309" },
  { test: /travel|flight|air|hotel|lodging/, Icon: Plane, bg: "bg-sky-100", fg: "#0284C7" },
  { test: /grocer|wholesale|market/, Icon: ShoppingCart, bg: "bg-green-100", fg: "#16A34A" },
  { test: /gas|fuel|\bev\b|charg/, Icon: Fuel, bg: "bg-orange-100", fg: "#EA580C" },
  { test: /entertain|stream|ticket/, Icon: Ticket, bg: "bg-purple-100", fg: "#9333EA" },
  { test: /retail|shop|store/, Icon: ShoppingBag, bg: "bg-rose-100", fg: "#E11D48" },
  { test: /transport|transit|ride|car/, Icon: Car, bg: "bg-indigo-100", fg: "#4F46E5" },
  { test: /wellness|health|fitness|gym/, Icon: HeartPulse, bg: "bg-teal-100", fg: "#0D9488" },
];

function catStyle(name?: string | null): { Icon: LucideIcon; bg: string; fg: string } {
  const n = (name ?? "").toLowerCase();
  return (
    CAT_STYLES.find((c) => c.test.test(n)) ?? {
      Icon: Sparkles,
      bg: "bg-sky-100",
      fg: "#0284C7",
    }
  );
}

// Benefit names in the catalog embed the headline value, e.g.
// "$120 Peloton Membership Credit". Split that leading amount off so the row
// title is clean text and the value appears once, in the value pill.
function splitNameValue(b: UserVisibleBenefit): { title: string; value: number | null } {
  const m = b.name.match(/^\$\s?([\d,]+(?:\.\d+)?)\s+(.+)$/);
  if (m) return { title: m[2].trim(), value: parseFloat(m[1].replace(/,/g, "")) };
  return { title: b.name, value: b.annual_value ?? b.value_per_period ?? null };
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

function daysLeftLabel(d: number): string {
  const n = Math.max(1, Math.ceil(d));
  return `${n} day${n === 1 ? "" : "s"} left`;
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
      // Negative days = already expired; keep them out of the urgency
      // buckets (consistent with BenefitRow, which only flags d >= 0).
      if (d != null && d >= 0 && d <= 7) week.push(b);
      else if (d != null && d >= 0 && d <= 30) month.push(b);
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
            onOpen={() =>
              router.push({
                pathname: "/benefit-detail/[key]" as never,
                params: {
                  key: `${item.user_card_id}__${item.benefit_definition_id}`,
                },
              })
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
  onOpen,
}: {
  b: UserVisibleBenefit;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { Icon, bg, fg } = catStyle(b.benefit_category?.name);
  const { title, value } = splitNameValue(b);
  const d = daysUntil(b.cycle?.period_end);
  const soon = !b.fully_redeemed && d != null && d >= 0 && d <= 7;

  return (
    <Pressable
      onPress={onToggle}
      onLongPress={onOpen}
      delayLongPress={260}
      className={cn(
        "bg-surface rounded-2xl p-3.5 flex-row items-center border border-border",
        b.fully_redeemed && "opacity-60",
      )}
    >
      {/* Colored category icon; a green check badge appears once redeemed. */}
      <View>
        <View className={cn("p-2.5 rounded-xl", bg)}>
          <Icon size={20} color={fg} />
        </View>
        {b.fully_redeemed && (
          <View className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-success items-center justify-center border border-surface">
            <Check size={10} color="white" />
          </View>
        )}
      </View>

      <View className="flex-1 ml-3 mr-2 flex-row items-center">
        <Text
          variant="title"
          numberOfLines={1}
          className={cn("shrink", b.fully_redeemed ? "text-text-muted" : "text-text")}
        >
          {title}
        </Text>
        {soon && d != null && (
          <View className="shrink-0 ml-2 px-2 py-0.5 rounded-full bg-warning-subtle">
            <Text variant="label" className="text-warning">
              {daysLeftLabel(d)}
            </Text>
          </View>
        )}
      </View>

      {value != null ? (
        <View className="shrink-0 px-3 py-1.5 rounded-full bg-primary-subtle">
          <Text variant="callout" className="text-primary-strong">
            {usd(value)}
          </Text>
        </View>
      ) : (
        <View className="shrink-0 px-3 py-1.5 rounded-full bg-surface-muted">
          <Text variant="callout" className="text-text-muted">
            Perk
          </Text>
        </View>
      )}
    </Pressable>
  );
}
