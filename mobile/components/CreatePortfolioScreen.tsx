// Onboarding for signed-in users with no portfolio membership yet.
// Rendered by app/(app)/_layout.tsx when useCurrentPortfolio resolves to
// null. Creating a portfolio causes the layout to unmount this screen and
// mount the tab nav.

import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useCreatePortfolio } from "@/lib/hooks";

export function CreatePortfolioScreen() {
  const [name, setName] = useState("My Cards");
  const create = useCreatePortfolio();
  const submitting = create.isPending;
  const canSubmit = name.trim().length > 0 && !submitting;

  function handleSubmit() {
    if (!canSubmit) return;
    create.mutate(name.trim(), {
      onError: (e) =>
        Alert.alert("Could not create portfolio", (e as Error).message),
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-gray-900 mb-2">
          Welcome to WanderFree
        </Text>
        <Text className="text-base text-gray-600 mb-8">
          Name your first portfolio. A portfolio holds a set of credit cards
          and the benefits and spending around them. You can create more
          later for a household, business, or someone else's cards.
        </Text>

        <Text className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Portfolio name
        </Text>
        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-6 text-gray-900"
          placeholder="My Cards"
          placeholderTextColor="#9ca3af"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          className={`rounded-xl py-3 items-center ${
            canSubmit ? "bg-blue-600" : "bg-gray-300"
          }`}
        >
          <Text className="text-white font-semibold text-base">
            {submitting ? "Creating..." : "Create portfolio"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
