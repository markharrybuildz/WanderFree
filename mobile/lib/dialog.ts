// Cross-platform confirm / notify helpers.
//
// react-native-web's Alert.alert delegates to window.alert / window.confirm,
// but multi-button behavior is brittle (the destructive button's onPress
// has been observed to silently no-op on some browser/version combos). We
// side-step that by calling the DOM primitives directly on web.

import { Alert, Platform } from "react-native";

/** Show a yes/no destructive confirmation. Calls `onConfirm` when the user
 *  picks the destructive action. Calls `onCancel` (if provided) when they
 *  cancel — most callers don't need this. */
export function confirmDestructive(args: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  const { title, message, confirmLabel = "Confirm", onConfirm, onCancel } = args;
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    } else {
      onCancel?.();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel", onPress: onCancel },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

/** Show a single-button notice. */
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
