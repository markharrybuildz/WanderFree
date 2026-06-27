// Procedural credit-card art — no image assets.
//
// A deterministic gradient + chip is derived from a seed string (issuer or
// product name), so every card gets stable, distinct art with zero asset
// management. Swap to real raster art later by rendering an <Image> here
// behind the same props.

import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

// Curated gradient pairs — picked over random hues so colors always read as
// "premium card", never muddy. Index chosen by a stable hash of the seed.
const GRADIENTS: [string, string][] = [
  ["#0EA5E9", "#0369A1"], // sky
  ["#6366F1", "#4338CA"], // indigo
  ["#14B8A6", "#0F766E"], // teal
  ["#F59E0B", "#B45309"], // amber
  ["#EC4899", "#9D174D"], // rose
  ["#10B981", "#047857"], // emerald
  ["#8B5CF6", "#6D28D9"], // violet
  ["#334155", "#0F172A"], // graphite
  ["#EA580C", "#9A3412"], // orange
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  return Math.abs(h);
}

export type CardArtThumbnailProps = {
  /** Stable string (issuer name or product id) that picks the gradient. */
  seed: string;
  /** Width in px; height follows the 1.585 credit-card aspect ratio. */
  width?: number;
};

export function CardArtThumbnail({ seed, width = 46 }: CardArtThumbnailProps) {
  const height = Math.round(width / 1.585);
  const [from, to] = GRADIENTS[hashSeed(seed) % GRADIENTS.length];

  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width, height, borderRadius: 7, padding: 5, overflow: "hidden" }}
    >
      {/* Diagonal sheen */}
      <View
        style={{
          position: "absolute",
          top: -height,
          left: width * 0.35,
          width: width * 0.5,
          height: height * 3,
          backgroundColor: "rgba(255,255,255,0.14)",
          transform: [{ rotate: "25deg" }],
        }}
      />
      {/* EMV chip */}
      <View
        style={{
          width: width * 0.2,
          height: height * 0.22,
          borderRadius: 2,
          backgroundColor: "rgba(255, 214, 102, 0.92)",
        }}
      />
      {/* Network dots, bottom-right */}
      <View
        style={{
          position: "absolute",
          right: 4,
          bottom: 4,
          flexDirection: "row",
        }}
      >
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: "rgba(255,255,255,0.55)",
          }}
        />
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            marginLeft: -3,
            backgroundColor: "rgba(255,255,255,0.30)",
          }}
        />
      </View>
    </LinearGradient>
  );
}
