// Per-user, per-device onboarding flag.
//
// Absent => the user has just signed in for the first time on this device
// and should be routed to the Cards tab with the welcome popup.
// Set => the user has either dismissed the popup or added their first card.
//
// The key includes user.id so that a delete-and-resignup test cycle (new
// auth user id) re-triggers onboarding without any extra cleanup.

import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (userId: string) => `wanderfree-onboarded-${userId}`;

export async function isOnboarded(userId: string): Promise<boolean> {
  // Best-effort: a storage read failure must not strand the user on a
  // loading screen, so treat "unknown" as not-onboarded.
  try {
    return (await AsyncStorage.getItem(key(userId))) === "true";
  } catch {
    return false;
  }
}

export async function markOnboarded(userId: string): Promise<void> {
  // Best-effort: this flag is non-critical, so swallow write failures
  // rather than break the success path that calls it. Worst case the
  // welcome popup simply shows again on the next cold launch.
  try {
    await AsyncStorage.setItem(key(userId), "true");
  } catch {
    // intentionally ignored
  }
}
