// Bottom sheet with a *decoupled* scrim + panel animation.
//
// RN's built-in <Modal animationType="slide"> translates the scrim and the
// panel together, so the dark overlay appears to slide up from the bottom edge
// instead of dimming the whole screen in place — which looks awkward. Here the
// two motions are driven separately with the built-in Animated API:
//   • scrim  → fades  (opacity 0 → 0.4) over the full screen, in place
//   • panel  → slides up from the bottom
// JS-only (no new native module), so it ships via OTA. Enter is a touch slower
// than exit for a responsive feel, and Reduce Motion drops the slide (fade
// only). We keep the Modal mounted through the exit tween, then unmount.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui/Text";

const SCRIM_COLOR = "#0F172A"; // slate-900 — matches --overlay in global.css
const SCRIM_OPACITY = 0.4;
const ENTER_MS = 220;
const EXIT_MS = 150;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function SheetModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Android 15 draws edge-to-edge, so the sheet needs the real bottom inset.
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();

  const [rendered, setRendered] = useState(open);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current; // 0 closed → 1 open

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (open) {
      setRendered(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [open, progress]);

  if (!rendered) return null;

  const scrimOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCRIM_OPACITY],
  });
  // Slide the panel up from just off the bottom. Using screen height as the
  // offset guarantees it starts fully off-screen regardless of the sheet's own
  // height; ease-out keeps the visible glide snappy. Reduce Motion → no slide.
  const translateY = reduceMotion
    ? 0
    : progress.interpolate({
        inputRange: [0, 1],
        outputRange: [screenH, 0],
      });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <AnimatedPressable
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: SCRIM_COLOR, opacity: scrimOpacity },
          ]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <Animated.View style={{ transform: [{ translateY }] }}>
          <Pressable
            className="bg-surface rounded-t-3xl px-5 pt-5"
            style={{ paddingBottom: Math.max(insets.bottom, 24) + 16 }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text variant="h2" className="mb-2">
              {title}
            </Text>
            {children}
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
