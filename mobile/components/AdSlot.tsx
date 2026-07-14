// Sponsored-content slot at the top of Home.
//
// No ad source is integrated yet: useAvailableAd() is the single seam where
// one plugs in later (a house-ads table in Supabase, AdMob, an affiliate
// feed…). It returns null today, so the slot renders nothing and Home lays
// out as if it doesn't exist. When an ad is available, the slot renders a
// clearly-labelled sponsored card.

import { Linking, Pressable, View } from "react-native";

import { Text } from "@/components/ui/Text";

export interface Ad {
  id: string;
  headline: string;
  body?: string;
  url?: string;
}

function useAvailableAd(): Ad | null {
  // Mock ad so the slot is visible while we design around it. Replace with
  // a real source (house-ads table, ad network) later; returning null hides
  // the slot entirely.
  return {
    id: "mock-summer-travel",
    headline: "Earn 5x points on summer travel",
    body: "Partner offer — book flights with your travel card and stack rewards on top of your credits.",
  };
}

export function AdSlot() {
  const ad = useAvailableAd();
  if (!ad) return null;

  return (
    <Pressable
      onPress={() => {
        if (ad.url) Linking.openURL(ad.url).catch(() => {});
      }}
      accessibilityRole={ad.url ? "link" : undefined}
      className="bg-surface rounded-2xl p-4 border border-border"
    >
      <View className="self-start px-2 py-0.5 rounded-full bg-surface-muted mb-2">
        <Text variant="label" className="text-text-subtle uppercase">
          Sponsored
        </Text>
      </View>
      <Text variant="title">{ad.headline}</Text>
      {ad.body ? (
        <Text variant="caption" className="text-text-muted mt-1">
          {ad.body}
        </Text>
      ) : null}
    </Pressable>
  );
}
