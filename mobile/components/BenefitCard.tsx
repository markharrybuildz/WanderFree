// One row in the benefits list. Tapping anywhere toggles "completed".
//
// Visuals follow the Figma's pattern: icon on the left (categorized),
// title + supporting text in the middle, completion checkmark on the right.

import {
  Check,
  CreditCard,
  Fuel,
  Plane,
  ShoppingCart,
  Utensils,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { Pressable, Text, View } from "react-native";

import { type BenefitCategory, formatReward, type UserVisibleBenefit } from "@/lib/types";

// Maps benefit categories to lucide icons. Categories not in the map fall
// back to the generic CreditCard icon. Values typed loosely as ComponentType
// because lucide-react-native's icon type is unwieldy across versions.
const CATEGORY_ICONS: Partial<Record<BenefitCategory, ComponentType<{ size?: number; color?: string }>>> = {
  dining: Utensils,
  flights: Plane,
  travel: Plane,
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
  const Icon = CATEGORY_ICONS[benefit.category] ?? CreditCard;
  const reward = formatReward(benefit);
  const expires = benefit.valid_to ? new Date(benefit.valid_to) : null;
  const isExpiringSoon =
    expires != null && expires.getTime() - Date.now() < 1000 * 60 * 60 * 24 * 14;

  return (
    <Pressable
      onPress={onToggle}
      className={`bg-white rounded-2xl p-4 border border-gray-200 flex-row items-center gap-3 ${
        benefit.completed ? "opacity-60" : ""
      }`}
    >
      <View className="p-2.5 bg-gray-100 rounded-xl">
        <Icon size={20} color="#374151" />
      </View>

      <View className="flex-1">
        <Text
          className={`text-sm font-medium ${
            benefit.completed ? "text-gray-500 line-through" : "text-gray-900"
          }`}
        >
          {benefit.card_name ?? "Network benefit"}
          {reward ? ` · ${reward}` : ""}
        </Text>
        <Text className="text-xs text-gray-600 mt-0.5" numberOfLines={2}>
          {benefit.source_quote}
        </Text>
        {expires && (
          <Text
            className={`text-xs mt-1 ${
              isExpiringSoon ? "text-orange-600" : "text-gray-500"
            }`}
          >
            Expires {expires.toLocaleDateString()}
          </Text>
        )}
      </View>

      <View
        className={`w-6 h-6 rounded-full items-center justify-center ${
          benefit.completed ? "bg-green-500" : "bg-gray-200"
        }`}
      >
        {benefit.completed && <Check size={14} color="white" />}
      </View>
    </Pressable>
  );
}
