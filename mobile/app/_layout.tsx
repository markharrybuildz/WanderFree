// Root layout. Wraps the entire app in:
//   * GestureHandlerRootView    required by react-native-gesture-handler
//   * SafeAreaProvider          for safe-area inset hooks
//   * PersistQueryClientProvider TanStack Query + AsyncStorage cache
//
// The Stack lets child route groups define their own layouts. We hide the
// default header here because each route group renders its own chrome.

import "../global.css";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { persister, queryClient } from "@/lib/queryClient";

export default function RootLayout() {
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
