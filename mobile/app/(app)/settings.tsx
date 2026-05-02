// Settings screen — minimal v1 with just account info + sign out.

import { router } from "expo-router";
import { Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { signOut, useAuthSession } from "@/lib/auth";

export default function SettingsScreen() {
  const { session } = useAuthSession();

  async function handleSignOut() {
    const { error } = await signOut();
    if (error) {
      Alert.alert("Sign out failed", error.message);
      return;
    }
    router.replace("/(auth)/sign-in");
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={["top"]}>
      <View className="bg-white border-b border-gray-200 px-4 py-4">
        <Text className="text-2xl font-bold text-gray-900">Settings</Text>
      </View>

      <View className="p-4">
        <View className="bg-white rounded-xl p-4 mb-4 border border-gray-200">
          <Text className="text-xs text-gray-500 uppercase tracking-wide">
            Signed in as
          </Text>
          <Text className="text-base text-gray-900 mt-1">
            {session?.user.email}
          </Text>
        </View>

        <Pressable
          onPress={handleSignOut}
          className="bg-white rounded-xl p-4 border border-gray-200"
        >
          <Text className="text-red-600 font-medium">Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
