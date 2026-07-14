// Realistic credit-card art — bundled brushed-metal face textures
// (generated once, no per-card assets) with the chip and network dots
// overlaid in code so corners and proportions stay crisp at any size.
//
// A deterministic texture is derived from a seed string (issuer or product
// id), so every card gets stable, distinct art with a fixed set of nine
// bundled images. Swap in real per-product raster art later by mapping
// product ids to sources ahead of the seed fallback.

import { Image, type ImageSourcePropType, View } from "react-native";

// Bundled face textures — order matters only for hash stability; keep
// appends at the end so existing cards don't change color.
const TEXTURES: ImageSourcePropType[] = [
  require("../assets/card-art/sky.jpg"),
  require("../assets/card-art/indigo.jpg"),
  require("../assets/card-art/teal.jpg"),
  require("../assets/card-art/gold.jpg"),
  require("../assets/card-art/rose.jpg"),
  require("../assets/card-art/emerald.jpg"),
  require("../assets/card-art/violet.jpg"),
  require("../assets/card-art/graphite.jpg"),
  require("../assets/card-art/copper.jpg"),
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
  /** Stable string (issuer name or product id) that picks the texture. */
  seed: string;
  /** Width in px; height follows the 1.585 credit-card aspect ratio. */
  width?: number;
};

export function CardArtThumbnail({ seed, width = 46 }: CardArtThumbnailProps) {
  const height = Math.round(width / 1.585);
  const texture = TEXTURES[hashSeed(seed) % TEXTURES.length];

  return (
    <View
      style={{
        width,
        height,
        borderRadius: 7,
        padding: 5,
        overflow: "hidden",
        backgroundColor: "#0F172A", // paints behind the texture while it decodes
      }}
    >
      <Image
        source={texture}
        resizeMode="cover"
        style={{ position: "absolute", top: 0, left: 0, width, height }}
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
    </View>
  );
}
