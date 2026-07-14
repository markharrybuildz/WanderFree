// Shared benefit list row + its category/expiry presentation helpers.
// Used by the Benefits tab and Home's "Expiring soon" section so a benefit
// looks identical everywhere: 3D category icon, cleaned-up name, an expiry
// line that escalates as the deadline nears, and a value pill.

import { Check } from "lucide-react-native";
import { memo } from "react";
import { Image, type ImageSourcePropType, Pressable, View } from "react-native";

import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";
import { benefitValueLabel, fmtMonthDay, splitNameValue } from "@/lib/format";
import { type UserVisibleBenefit } from "@/lib/types";

const DAY_MS = 1000 * 60 * 60 * 24;

// Category → bundled 3D icon. Matched by keyword so both enum-style keys
// ("wholesale_club") and display names ("Groceries") resolve.
const CAT_ICONS: { test: RegExp; source: ImageSourcePropType }[] = [
  { test: /dining|restaurant|food/, source: require("../assets/benefit-icons/dining.png") },
  { test: /travel|flight|air|hotel|lodging/, source: require("../assets/benefit-icons/travel.png") },
  { test: /grocer|wholesale|market/, source: require("../assets/benefit-icons/groceries.png") },
  { test: /gas|fuel|\bev\b|charg/, source: require("../assets/benefit-icons/gas.png") },
  { test: /entertain|stream|ticket/, source: require("../assets/benefit-icons/entertainment.png") },
  { test: /retail|shop|store/, source: require("../assets/benefit-icons/shopping.png") },
  { test: /transport|transit|ride|car/, source: require("../assets/benefit-icons/transit.png") },
  { test: /wellness|health|fitness|gym/, source: require("../assets/benefit-icons/wellness.png") },
];

const FALLBACK_ICON: ImageSourcePropType = require("../assets/benefit-icons/sparkle.png");

function catIcon(name?: string | null): ImageSourcePropType {
  const n = (name ?? "").toLowerCase();
  return CAT_ICONS.find((c) => c.test.test(n))?.source ?? FALLBACK_ICON;
}

/** Fractional days until the cycle ends (null when no end date). */
export function daysUntil(end?: string | null): number | null {
  if (!end) return null;
  return (new Date(end).getTime() - Date.now()) / DAY_MS;
}

function daysLeftLabel(d: number): string {
  const n = Math.max(1, Math.ceil(d));
  return `${n} day${n === 1 ? "" : "s"} left`;
}

/** The per-row expiry tag for an unredeemed benefit: escalates from a muted
 *  reset date, to an amber countdown within a week, to a muted "Expired" once
 *  the period has passed. Null for perks (no cycle) and redeemed benefits
 *  (which already show a check badge). */
export function expiryTag(
  b: UserVisibleBenefit,
  d: number | null,
): { text: string; tone: "amber" | "muted" } | null {
  if (b.fully_redeemed || d == null) return null;
  if (d < 0) return { text: "Expired", tone: "muted" };
  if (d <= 7) return { text: daysLeftLabel(d), tone: "amber" };
  return { text: `Resets ${fmtMonthDay(b.cycle!.period_end)}`, tone: "muted" };
}

export const BenefitRow = memo(function BenefitRow({
  b,
  onOpen,
}: {
  b: UserVisibleBenefit;
  onOpen: (b: UserVisibleBenefit) => void;
}) {
  const icon = catIcon(b.benefit_category?.name);
  const { title } = splitNameValue(b);
  const valueLabel = benefitValueLabel(b);
  const d = daysUntil(b.cycle?.period_end);
  const tag = expiryTag(b, d);

  return (
    <Pressable
      onPress={() => onOpen(b)}
      className={cn(
        "bg-surface rounded-2xl p-3.5 flex-row items-center border border-border",
        b.fully_redeemed && "opacity-60",
      )}
    >
      {/* 3D category icon; a green check badge appears once redeemed. */}
      <View>
        <Image source={icon} resizeMode="contain" style={{ width: 44, height: 44 }} />
        {b.fully_redeemed && (
          <View className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-success items-center justify-center border border-surface">
            <Check size={10} color="white" />
          </View>
        )}
      </View>

      {/* Title above the reset/expiry line, so long benefit names get the
          full row width instead of ellipsizing next to a tag. */}
      <View className="flex-1 ml-3 mr-2">
        <Text
          variant="title"
          numberOfLines={2}
          className={b.fully_redeemed ? "text-text-muted" : "text-text"}
        >
          {title}
        </Text>
        {tag && (
          <Text
            variant={tag.tone === "amber" ? "label" : "caption"}
            className={cn(
              "mt-0.5",
              tag.tone === "amber" ? "text-warning" : "text-text-muted",
            )}
          >
            {tag.text}
          </Text>
        )}
      </View>

      {valueLabel != null ? (
        <View className="shrink-0 px-3 py-1.5 rounded-full bg-primary-subtle">
          <Text variant="callout" className="text-primary-strong">
            {valueLabel}
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
});
