// One row in the benefits list. Tapping anywhere toggles "fully redeemed".

import {
  Check,
  CreditCard,
  Fuel,
  type LucideIcon,
  Plane,
  ShoppingCart,
  Utensils,
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { formatBenefitValue, type UserVisibleBenefit } from "@/lib/types";

// Maps benefit category names (from benefit_categories.name) to lucide
// icons. Categories not in the map fall back to the generic CreditCard
// icon. Keys are lowercase to make lookup forgiving.
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

interface Props {
  benefit: UserVisibleBenefit;
  onToggle: () => void;
}

export function BenefitCard({ benefit, onToggle }: Props) {
  const categoryKey = benefit.benefit_category?.name?.toLowerCase() ?? "";
  const Icon = CATEGORY_ICONS[categoryKey] ?? CreditCard;
  const value = formatBenefitValue(benefit);
  const expires = benefit.cycle?.period_end ? new Date(benefit.cycle.period_end) : null;
  const isExpiringSoon =
    expires != null && expires.getTime() - Date.now() < 1000 * 60 * 60 * 24 * 14;

  return (
    <Pressable
      onPress={onToggle}
      className={`bg-white rounded-2xl p-4 border border-gray-200 flex-row items-center gap-3 ${
        benefit.fully_redeemed ? "opacity-60" : ""
      }`}
    >
      <View className="p-2.5 bg-gray-100 rounded-xl">
        <Icon size={20} color="#374151" />
      </View>

      <View className="flex-1">
        <Text
          className={`text-sm font-medium ${
            benefit.fully_redeemed ? "text-gray-500 line-through" : "text-gray-900"
          }`}
        >
          {benefit.card_name} · {value} {benefit.reset_frequency}
        </Text>
        <Text className="text-xs text-gray-600 mt-0.5" numberOfLines={2}>
          {benefit.name}
        </Text>
        {expires && (
          <Text
            className={`text-xs mt-1 ${
              isExpiringSoon ? "text-orange-600" : "text-gray-500"
            }`}
          >
            Cycle ends {expires.toLocaleDateString()}
          </Text>
        )}
      </View>

      <View
        className={`w-6 h-6 rounded-full items-center justify-center ${
          benefit.fully_redeemed ? "bg-green-500" : "bg-gray-200"
        }`}
      >
        {benefit.fully_redeemed && <Check size={14} color="white" />}
      </View>
    </Pressable>
  );
}
