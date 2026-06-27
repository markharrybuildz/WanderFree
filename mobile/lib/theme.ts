// Design-system theme module.
//
// Two things live here that className tokens can't express:
//   1. The typographic scale (font family + size + line-height per role),
//      applied as style objects because React Native can't combine a custom
//      fontFamily with a separate fontWeight reliably — each weight is its own
//      loaded family (Inter_400Regular, Outfit_700Bold…).
//   2. Raw color hex constants, for the handful of props that take a color
//      value rather than a className: icon `color`, the Tabs tint options,
//      and LinearGradient `colors`.
//
// Color hexes here MUST mirror the light-mode tokens in global.css. They are
// the light values only (icons/gradients that need dynamic dark values should
// read from a NativeWind hook instead).

import { Dimensions, PixelRatio } from "react-native";

// ---------------------------------------------------------------------------
// Responsive scaling
// ---------------------------------------------------------------------------

const BASE_WIDTH = 375; // iPhone 11/12/13/14 logical width — our design baseline
const { width: SCREEN_WIDTH } = Dimensions.get("window");

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Scale a point size by device width, damped and clamped so small phones and
 * large tablets stay sane. `factor` (0–1) controls how strongly the raw width
 * ratio is applied — 0.5 means we move half-way toward the proportional size.
 *
 * This is *screen-size* scaling. Accessibility (Dynamic Type) scaling is a
 * separate axis handled by `allowFontScaling` on the Text primitive.
 */
export function moderateScale(size: number, factor = 0.5): number {
  const ratio = clamp(SCREEN_WIDTH / BASE_WIDTH, 0.9, 1.25);
  const scaled = size + (size * ratio - size) * factor;
  // Round to the nearest pixel boundary to avoid blurry text.
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
}

// Cap OS Dynamic Type growth so large accessibility settings can't shatter
// layouts. 1.6× still meaningfully enlarges text for low-vision users.
export const MAX_FONT_SCALE = 1.6;

// ---------------------------------------------------------------------------
// Font families (must match the families loaded in app/_layout.tsx)
// ---------------------------------------------------------------------------

export const fonts = {
  displayBold: "Outfit_700Bold",
  displaySemibold: "Outfit_600SemiBold",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// ---------------------------------------------------------------------------
// Type scale — roles, not raw sizes. Sizes/line-heights are pre-scaled.
// ---------------------------------------------------------------------------

export type TypeVariant =
  | "display"
  | "h1"
  | "h2"
  | "title"
  | "body"
  | "callout"
  | "caption"
  | "label"
  | "button";

type TypeStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
};

export const typeScale: Record<TypeVariant, TypeStyle> = {
  display: {
    fontFamily: fonts.displayBold,
    fontSize: moderateScale(30),
    lineHeight: moderateScale(36),
    letterSpacing: -0.5,
  },
  h1: {
    fontFamily: fonts.displayBold,
    fontSize: moderateScale(24),
    lineHeight: moderateScale(30),
    letterSpacing: -0.3,
  },
  h2: {
    fontFamily: fonts.displaySemibold,
    fontSize: moderateScale(20),
    lineHeight: moderateScale(26),
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: moderateScale(16),
    lineHeight: moderateScale(22),
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: moderateScale(16),
    lineHeight: moderateScale(24),
  },
  callout: {
    fontFamily: fonts.medium,
    fontSize: moderateScale(15),
    lineHeight: moderateScale(20),
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: moderateScale(13),
    lineHeight: moderateScale(18),
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: moderateScale(13),
    lineHeight: moderateScale(16),
    letterSpacing: 0.3,
  },
  button: {
    fontFamily: fonts.semibold,
    fontSize: moderateScale(15),
    lineHeight: moderateScale(20),
  },
};

// ---------------------------------------------------------------------------
// Color constants (light mode) — mirror global.css. For color-prop usage only.
// ---------------------------------------------------------------------------

export const colors = {
  bg: "#F0F9FF",
  surface: "#FFFFFF",
  surfaceMuted: "#F1F5F9",
  text: "#0F172A",
  textMuted: "#64748B",
  textSubtle: "#94A3B8",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",

  primary: "#0EA5E9",
  primaryStrong: "#0369A1",
  primaryPress: "#075985",
  primarySubtle: "#E0F2FE",
  accent: "#EA580C",
  accentPress: "#C2410C",
  accentSubtle: "#FFF7ED",

  error: "#DC2626",
  errorText: "#B91C1C",
  errorSubtle: "#FEF2F2",
  errorBorder: "#FECACA",

  warning: "#B45309",
  warningFill: "#F59E0B",
  warningSubtle: "#FFFBEB",

  success: "#16A34A",
  successText: "#15803D",
  successSubtle: "#F0FDF4",

  navSurface: "#FFFFFF",
  navActive: "#0369A1",
  navInactive: "#6B7280",
} as const;
