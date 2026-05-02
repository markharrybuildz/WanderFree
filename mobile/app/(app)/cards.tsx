// Cards screen — add or remove cards from the user's wallet.
//
// Shows the full catalog. Cards already added show "Added" + tap-to-remove
// (with a confirmation alert because removal cascades to the user's
// completion state for that card's benefits).

import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  useAddUserCard,
  useAllCards,
  useRemoveUserCard,
  useUserCards,
} from "@/lib/hooks";

export default function CardsScreen() {
  const { data: allCards, isPending: loadingCards } = useAllCards();
  const { data: userCards, isPending: loadingUserCards } = useUserCards();
  const add = useAddUserCard();
  const remove = useRemoveUserCard();

  const heldCardIds = new Set((userCards ?? []).map((uc) => uc.card_id));

  if (loadingCards || loadingUserCards) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <Text className="text-2xl font-bold text-gray-900">Cards</Text>
        <Text className="text-sm text-gray-600 mt-1">
          {heldCardIds.size} of {allCards?.length ?? 0} added
        </Text>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 16, gap: 8 }}
        data={allCards ?? []}
        keyExtractor={(c) => String(c.id)}
        renderItem={({ item }) => {
          const held = heldCardIds.has(item.id);
          const annualFee =
            item.annual_fee_cents != null
              ? `$${(item.annual_fee_cents / 100).toFixed(0)}/yr`
              : null;

          return (
            <View className="bg-white rounded-xl p-4 flex-row items-center justify-between border border-gray-200">
              <View className="flex-1 pr-3">
                <Text className="text-base font-medium text-gray-900">
                  {item.name}
                </Text>
                <Text className="text-xs text-gray-500 mt-1">
                  {item.issuer?.name}
                  {item.is_business ? " · Business" : ""}
                  {annualFee ? ` · ${annualFee}` : ""}
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  if (held) {
                    Alert.alert(
                      "Remove card?",
                      "Your benefit completion history for this card will be removed.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => remove.mutate(item.id),
                        },
                      ],
                    );
                  } else {
                    add.mutate(item.id);
                  }
                }}
                className={`px-4 py-2 rounded-lg ${
                  held ? "bg-gray-100" : "bg-blue-600"
                }`}
              >
                <Text
                  className={`text-sm ${
                    held ? "text-gray-700" : "text-white font-medium"
                  }`}
                >
                  {held ? "Added" : "Add"}
                </Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center justify-center py-12">
            <Text className="text-gray-500 text-center">
              No cards in the catalog yet.{"\n"}
              Run the extraction pipeline to populate it.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
