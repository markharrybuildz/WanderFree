// Account — signed-in identity, sign out, delete account, privacy policy.
// The profile switcher (portfolios, renamed "Profiles" in the UI) lives in
// the Home header's profile button now, not here.

import { router } from "expo-router";
import { LogOut, Trash2 } from "lucide-react-native";
import { Alert, Pressable, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/Text";
import { useAnalyticsEnabled } from "@/lib/analytics";
import { deleteAccount, signOut, useAuthSession } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function AccountScreen() {
  const { session } = useAuthSession();
  const [analyticsOn, setAnalyticsOn] = useAnalyticsEnabled();

  async function handleSignOut() {
    const { error } = await signOut();
    if (error) {
      Alert.alert("Sign out failed", error.message);
      return;
    }
    router.replace("/(auth)/sign-in");
  }

  function handleDeleteAccount() {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and all your data — cards, profiles, benefit history, and spending. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const { error } = await deleteAccount();
            if (error) {
              Alert.alert("Could not delete account", error.message);
              return;
            }
            await signOut();
            router.replace("/(auth)/sign-in");
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <View className="bg-surface border-b border-border px-4 py-4">
        <Text variant="display">Account</Text>
      </View>

      <View className="p-4">
        <View className="bg-surface rounded-xl p-4 mb-4 border border-border">
          <Text variant="label" className="text-text-subtle uppercase">
            Signed in as
          </Text>
          <Text variant="body" className="mt-1">
            {session?.user.email}
          </Text>
        </View>

        <Text variant="label" className="text-text-subtle uppercase px-2 mb-2">
          Privacy
        </Text>
        <View className="bg-surface rounded-xl border border-border p-4 mb-4">
          <View className="flex-row items-center justify-between">
            <Text variant="callout" className="flex-1 pr-3">
              Share anonymous usage data
            </Text>
            <Switch
              value={analyticsOn}
              onValueChange={setAnalyticsOn}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Share anonymous usage data"
            />
          </View>
          <Text variant="caption" className="text-text-subtle mt-2">
            Helps improve WanderFree. Screens viewed and features used — never
            your email, card details, or spending amounts. See the Privacy
            Policy below.
          </Text>
        </View>

        <View className="bg-surface rounded-xl border border-border overflow-hidden">
          <Pressable
            onPress={handleSignOut}
            className="flex-row items-center gap-3 px-4 py-3.5 active:bg-surface-muted"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOut size={17} color={colors.textMuted} />
            <Text variant="callout">Sign out</Text>
          </Pressable>
          <Pressable
            onPress={handleDeleteAccount}
            className="border-t border-border px-4 py-3.5 active:bg-error-subtle"
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <View className="flex-row items-center gap-3">
              <Trash2 size={17} color={colors.errorText} />
              <Text variant="callout" className="text-error-text">
                Delete account
              </Text>
            </View>
            <Text variant="caption" className="text-text-subtle mt-1 ml-8">
              Permanently removes your account and all data
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push("/privacy" as never)}
          className="mt-5 items-center"
        >
          <Text variant="caption" className="text-text-subtle underline">
            Privacy Policy
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
