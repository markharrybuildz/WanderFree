// A label/value row used inside the card- and benefit-detail info cards.
// `truncateValue` right-aligns and clips a long value to one line.

import { View } from "react-native";

import { Text } from "@/components/ui/Text";
import { cn } from "@/lib/cn";

export function DetailRow({
  label,
  value,
  last,
  truncateValue,
}: {
  label: string;
  value: string;
  last?: boolean;
  truncateValue?: boolean;
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
      <Text
        variant="title"
        className={cn(truncateValue && "shrink pl-3 text-right")}
        numberOfLines={truncateValue ? 1 : undefined}
      >
        {value}
      </Text>
    </View>
  );
}
