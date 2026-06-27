// Authenticated tab navigator.
//
// Gates: this layout is also the auth + portfolio guard for the (app) route
// group. Anything inside (app)/ requires (a) a session and (b) the user to
// be a member of at least one portfolio. If they have no portfolio yet, we
// render the onboarding screen instead of the tabs.

import { Redirect, Tabs } from "expo-router";
import { CreditCard, Gift, Settings } from "lucide-react-native";
import { ActivityIndicator, View } from "react-native";

import { CreatePortfolioScreen } from "@/components/CreatePortfolioScreen";
import { useAuthSession } from "@/lib/auth";
import { useCurrentPortfolio } from "@/lib/hooks";
import { colors, fonts } from "@/lib/theme";

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

  // Don't decide between onboarding and tabs until we know the portfolio
  // state — otherwise a fresh sign-in flashes the onboarding screen before
  // the portfolio query resolves.
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
    <Tabs
      screenOptions={{
        headerShown: false,
        // A1 nav: clean white bar, sky-blue active, grey inactive.
        tabBarActiveTintColor: colors.navActive,
        tabBarInactiveTintColor: colors.navInactive,
        tabBarStyle: {
          backgroundColor: colors.navSurface,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="benefits"
        options={{
          title: "Benefits",
          tabBarIcon: ({ color }) => <Gift size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cards"
        options={{
          title: "Cards",
          tabBarIcon: ({ color }) => <CreditCard size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Settings size={22} color={color} />,
        }}
      />
      <Tabs.Screen name="card-details/[id]" options={{ href: null }} />
    </Tabs>
  );
}
