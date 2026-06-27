// Root layout. Wraps the entire app in:
//   * GestureHandlerRootView    required by react-native-gesture-handler
//   * SafeAreaProvider          for safe-area inset hooks
//   * PersistQueryClientProvider TanStack Query + AsyncStorage cache
//
// It also loads the design-system fonts (Outfit display + Inter body) and
// holds the native splash screen until they're ready, so the first paint
// already uses the brand typography instead of flashing a system font.
//
// The Stack lets child route groups define their own layouts. We hide the
// default header here because each route group renders its own chrome.

import "../global.css";

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import {
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from "@expo-google-fonts/outfit";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { persister, queryClient } from "@/lib/queryClient";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const onLayout = useCallback(() => {
    // Hide the splash once fonts resolve (or fail — we don't block forever).
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayout}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister }}
        >
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="auto" />
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
