// Onboarding for signed-in users with no portfolio membership yet.
// Rendered by app/(app)/_layout.tsx when useCurrentPortfolio resolves to
// null. Creating a portfolio causes the layout to unmount this screen and
// mount the tab nav.

import { useState } from "react";
import { Alert, Image, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { useCreatePortfolio } from "@/lib/hooks";
import { colors, fonts } from "@/lib/theme";

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
    <SafeAreaView className="flex-1 bg-bg">
      <View className="flex-1 justify-center px-6">
        <Image
          source={require("../assets/logo-mark.png")}
          style={{ width: 88, height: 88 }}
          className="mb-2 -ml-2"
        />
        <Text variant="display" className="mb-2">
          Welcome to WanderFree
        </Text>
        <Text variant="body" className="text-text-muted mb-8">
          Name your first portfolio. A portfolio holds a set of credit cards
          and the benefits and spending around them. You can create more
          later for a household, business, or someone else&apos;s cards.
        </Text>

        <Text variant="label" className="text-text-subtle uppercase mb-2">
          Portfolio name
        </Text>
        <TextInput
          className="bg-surface border border-border rounded-xl px-4 py-3 mb-6 text-text"
          style={{ fontFamily: fonts.regular, fontSize: 16 }}
          placeholder="My Cards"
          placeholderTextColor={colors.textSubtle}
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Button
          variant="primary"
          size="lg"
          fullWidth
          label="Create portfolio"
          loading={submitting}
          disabled={name.trim().length === 0}
          onPress={handleSubmit}
        />
      </View>
    </SafeAreaView>
  );
}
