// The two top-of-screen stat cards (Total / Pending). Visually mirrors the
// Figma's grid-cols-2 layout — caller wraps two of these in a flex-row.

import { CreditCard, Gift } from "lucide-react-native";
import { Text, View } from "react-native";

interface Props {
  label: string;
  value: number;
  variant: "blue" | "orange";
}

const VARIANTS = {
  blue: { bg: "bg-blue-100", iconColor: "#2563eb", icon: CreditCard },
  orange: { bg: "bg-orange-100", iconColor: "#ea580c", icon: Gift },
} as const;

export function StatsCard({ label, value, variant }: Props) {
  const { bg, iconColor, icon: Icon } = VARIANTS[variant];

  return (
    <View className="flex-1 bg-white rounded-2xl p-4 border border-gray-200">
      <View className="flex-row items-center gap-3">
        <View className={`p-2.5 ${bg} rounded-xl`}>
          <Icon size={20} color={iconColor} />
        </View>
        <View>
          <Text className="text-xs text-gray-600">{label}</Text>
          <Text className="text-2xl font-bold text-gray-900">{value}</Text>
        </View>
      </View>
    </View>
  );
}
