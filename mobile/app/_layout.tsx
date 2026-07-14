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
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { persister, queryClient } from "@/lib/queryClient";

SplashScreen.preventAutoHideAsync().catch(() => {});

// Hard cap on how long we'll hold the splash for fonts. If the Google Fonts
// stall on a device, we render anyway (system font as a brief fallback) rather
// than freeze on the splash forever.
const FONT_TIMEOUT_MS = 3000;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const [ready, setReady] = useState(false);

  // Become ready as soon as fonts resolve (or fail); otherwise fall back
  // after the timeout. Guarding the timer on the font state means it's
  // cleared the moment fonts win, so a slow timer can't fire later and
  // stomp an already-ready app.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      setReady(true);
      return;
    }
    const t = setTimeout(() => setReady(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [fontsLoaded, fontError]);

  // Hide the native splash once the tree is committed. This must be an
  // effect, not an onLayout on GestureHandlerRootView: Android's
  // GestureHandlerRootView never forwards onLayout, so a layout-based hide
  // leaves the splash up forever there (iOS forwards it fine).
  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
