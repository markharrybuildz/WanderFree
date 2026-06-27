// Entry route — auth gate.
//
// On cold launch:
//   1. useAuthSession() fires getSession() against AsyncStorage
//   2. While loading: render a spinner (not a redirect — Expo Router would
//      bounce the user even if they're signed in)
//   3. Once resolved:
//        - signed out  -> /(auth)/sign-in
//        - signed in, no onboarded flag -> /(app)/cards (popup will show)
//        - signed in, onboarded -> /(app)/benefits

import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useAuthSession } from "@/lib/auth";
import { isOnboarded } from "@/lib/onboarding";

export default function Index() {
  const { session, loading } = useAuthSession();
  const userId = session?.user.id ?? null;
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) {
      setOnboarded(null);
      return;
    }
    let active = true;
    isOnboarded(userId).then((v) => {
      if (active) setOnboarded(v);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  if (loading || (session && onboarded === null)) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/sign-in" />;
  return onboarded ? (
    <Redirect href="/(app)/benefits" />
  ) : (
    <Redirect href="/(app)/cards" />
  );
}
