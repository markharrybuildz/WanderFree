// Snackbar host + card. Mounted once in the root layout; subscribes to the
// snackbar store (lib/snackbar.ts) and renders the visible item as a floating
// card above the tab bar.
//
// Behavior:
//   * Enters by sliding up + fading in; leaves by sliding down + fading out.
//   * Swipe down to dismiss.
//   * Auto-dismisses after the item's duration (paused while it has no timer,
//     i.e. duration 0 = sticky).
//   * Announces to screen readers and fires a variant-appropriate haptic.
//
// Visual language matches the design system: white surface card, subtle
// tinted status icon, rounded-xl, soft shadow — never raw hex (semantic
// className tokens only).

import * as Haptics from "expo-haptics";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  FadeOutDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/Text";
import { colors } from "@/lib/theme";
import {
  snackbar,
  type SnackbarItem,
  type SnackbarVariant,
} from "@/lib/snackbar";

// Offset from the bottom safe-area inset — tuned to clear the ~64px tab bar so
// the card floats just above it on tab screens.
const BOTTOM_OFFSET = 70;
const SWIPE_DISMISS_THRESHOLD = 40;
const ANIM_MS = 220;

const ICON: Record<SnackbarVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

// Icon tint + left accent border per variant.
const ICON_COLOR: Record<SnackbarVariant, string> = {
  success: colors.success,
  error: colors.error,
  info: colors.primary,
};

const ACCENT_BORDER: Record<SnackbarVariant, string> = {
  success: "border-l-success",
  error: "border-l-error",
  info: "border-l-primary",
};

function haptic(variant: SnackbarVariant) {
  if (Platform.OS === "web") return;
  const type =
    variant === "success"
      ? Haptics.NotificationFeedbackType.Success
      : variant === "error"
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Warning;
  Haptics.notificationAsync(type).catch(() => {});
}

/** One animated snackbar card. Keyed by item.id in the host so a new item
 *  remounts and re-runs the enter animation. */
function SnackbarCard({
  item,
  onDismiss,
}: {
  item: SnackbarItem;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Only the swipe offset lives in a shared value; the show/hide transition is
  // handled by Reanimated layout animations (entering/exiting), which are the
  // robust cross-platform path — unlike a manual withTiming enter started in an
  // effect, they render the visible final state even where unsupported rather
  // than getting stuck invisible.
  const dragY = useSharedValue(0);
  const StatusIcon = ICON[item.variant];

  useEffect(() => {
    haptic(item.variant);
    AccessibilityInfo.announceForAccessibility(item.message);
    if (item.duration > 0) {
      const t = setTimeout(onDismiss, item.duration);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Follow the finger downward only; ignore upward drags.
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > SWIPE_DISMISS_THRESHOLD) {
        runOnJS(onDismiss)();
      } else {
        dragY.value = withTiming(0, { duration: 150 });
      }
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  function onActionPress() {
    item.action?.onPress();
    onDismiss();
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={FadeInDown.duration(ANIM_MS)}
        exiting={FadeOutDown.duration(ANIM_MS)}
        style={[
          style,
          {
            position: "absolute",
            left: 16,
            right: 16,
            bottom: insets.bottom + BOTTOM_OFFSET,
          },
        ]}
        pointerEvents="box-none"
      >
        <View
          accessibilityLiveRegion="polite"
          className={`flex-row items-center gap-3 rounded-xl border border-border border-l-4 bg-surface px-4 py-3 shadow-lg ${ACCENT_BORDER[item.variant]}`}
        >
          <StatusIcon size={20} color={ICON_COLOR[item.variant]} />
          <Text variant="callout" className="flex-1 text-text" numberOfLines={3}>
            {item.message}
          </Text>

          {item.action ? (
            <Pressable
              onPress={onActionPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={item.action.label}
              className="active:opacity-60"
            >
              {/* Inline color: a `text-*` className loses to the Text
                  primitive's default `text-text` under NativeWind's
                  stylesheet ordering, so set the action color directly. */}
              <Text variant="button" style={{ color: colors.primaryStrong }}>
                {item.action.label}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => close()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              className="active:opacity-60"
            >
              <X size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Mount once, above the navigator. Renders the current snackbar (if any). */
export function SnackbarHost() {
  const [item, setItem] = useState<SnackbarItem | null>(null);

  useEffect(() => snackbar.subscribe(setItem), []);

  if (!item) return null;
  return (
    <SnackbarCard
      key={item.id}
      item={item}
      onDismiss={() => snackbar.dismiss(item.id)}
    />
  );
}
