// Entry route — auth gate.
//
// On cold launch:
//   1. useAuthSession() fires getSession() against AsyncStorage
//   2. While loading: render a spinner (not a redirect — Expo Router would
//      bounce the user even if they're signed in)
//   3. Once resolved: redirect to /(app)/benefits if signed in,
//      /(auth)/sign-in otherwise.

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuthSession } from "@/lib/auth";

export default function Index() {
  const { session, loading } = useAuthSession();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator />
      </View>
    );
  }

  return session ? (
    <Redirect href="/(app)/benefits" />
  ) : (
    <Redirect href="/(auth)/sign-in" />
  );
}
