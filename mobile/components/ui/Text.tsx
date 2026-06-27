// Typed Text primitive.
//
// Typography is driven by a `variant` (role from the type scale) applied as a
// style object — see lib/theme.ts for why custom fonts can't go through
// className font-weight utilities. Color stays in className-land so it tracks
// the semantic tokens (and dark mode) automatically; default is `text-text`.
//
// `allowFontScaling` is kept ON (accessibility / Dynamic Type) but capped via
// maxFontSizeMultiplier so a huge system setting can't break layouts.

import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { cn } from "@/lib/cn";
import { MAX_FONT_SCALE, typeScale, type TypeVariant } from "@/lib/theme";

export type TextProps = RNTextProps & {
  variant?: TypeVariant;
  /** Tailwind text-color class, e.g. "text-text-muted". Defaults to text-text. */
  className?: string;
};

export function Text({
  variant = "body",
  className,
  style,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
  ...rest
}: TextProps) {
  return (
    <RNText
      className={cn("text-text", className)}
      style={[typeScale[variant], style]}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      {...rest}
    />
  );
}
