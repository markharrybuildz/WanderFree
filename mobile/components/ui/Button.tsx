// Button primitive with explicit, visually-distinct states.
//
// Variants:  primary (orange action) · secondary (sky tonal) ·
//            destructive (error, subtle) · ghost (transparent)
// States:    default · pressed (darker + 0.97 scale) · disabled (muted, no
//            press) · loading (spinner, interaction locked, width preserved) ·
//            focus (visible ring on web/keyboard)
//
// Touch target is >= 44px (Apple HIG) and press fires a light haptic on native.

import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableProps,
  View,
} from "react-native";

import { cn } from "@/lib/cn";
import { colors } from "@/lib/theme";

import { Text } from "./Text";

type Variant = "primary" | "secondary" | "destructive" | "ghost";
type Size = "sm" | "md" | "lg";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  /** Rendered before the label; caller sets its color (use iconColor map). */
  leftIcon?: React.ReactNode;
  className?: string;
};

// Container classes per variant: [resting, pressed (active:)].
const VARIANT_BG: Record<Variant, string> = {
  primary: "bg-accent active:bg-accent-press",
  secondary: "bg-primary-subtle active:bg-primary/20",
  destructive: "bg-error-subtle border border-error-border active:bg-error/10",
  ghost: "bg-transparent active:bg-surface-muted",
};

const VARIANT_TEXT: Record<Variant, string> = {
  primary: "text-white",
  secondary: "text-primary-strong",
  destructive: "text-error-text",
  ghost: "text-text",
};

// Hex for the label/spinner/icon, so an icon passed in can match the text.
export const iconColor: Record<Variant, string> = {
  primary: "#FFFFFF",
  secondary: colors.primaryStrong,
  destructive: colors.errorText,
  ghost: colors.text,
};

const SIZE_BOX: Record<Size, string> = {
  sm: "h-11 px-4 gap-1.5", // 44px — min touch target
  md: "h-12 px-5 gap-2", // 48px
  lg: "h-14 px-6 gap-2", // 56px
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  leftIcon,
  className,
  onPress,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  function handlePress(e: Parameters<NonNullable<PressableProps["onPress"]>>[0]) {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.(e);
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      // Pressed scale via style (className can't be a pressed-state function);
      // pressed *color* comes from the active: classes above.
      style={({ pressed }) =>
        pressed && !isDisabled ? { transform: [{ scale: 0.97 }] } : undefined
      }
      className={cn(
        "flex-row items-center justify-center rounded-xl",
        SIZE_BOX[size],
        isDisabled ? "bg-surface-muted border-0" : VARIANT_BG[variant],
        fullWidth && "w-full",
        // Web/keyboard focus ring (no-op on native).
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === "primary" ? "#FFFFFF" : colors.primaryStrong}
        />
      ) : (
        <>
          {leftIcon ? <View>{leftIcon}</View> : null}
          <Text
            variant="button"
            className={isDisabled ? "text-text-subtle" : VARIANT_TEXT[variant]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
