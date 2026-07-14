// Authenticated stack: the (tabs) navigator plus the detail screens pushed
// on top of it. Keeping card-details / benefit-detail out of the tab
// navigator makes them real stack pushes, so router.back() returns to
// whichever tab opened them (Home or Benefits) instead of falling back to
// the first tab.
//
// Gates: this layout is also the auth + profile guard for the (app) route
// group. Anything inside (app)/ requires (a) a session and (b) the user to
// be a member of at least one profile. If they have no profile yet, we
// render the onboarding screen instead.

import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { CreatePortfolioScreen } from "@/components/CreatePortfolioScreen";
import { useAuthSession } from "@/lib/auth";
import { useCurrentPortfolio } from "@/lib/hooks";

export default function AppLayout() {
  const { session, loading: authLoading } = useAuthSession();
  const { data: portfolio, isLoading: portfolioLoading } = useCurrentPortfolio();

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // Don't decide between onboarding and tabs until we know the profile
  // state — otherwise a fresh sign-in flashes the onboarding screen before
  // the query resolves.
  if (portfolioLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator />
      </View>
    );
  }

  if (!portfolio) {
    return <CreatePortfolioScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="card-details/[id]" />
      <Stack.Screen name="benefit-detail/[key]" />
    </Stack>
  );
}
